import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeState } from "./state.js";
import { ProviderRegistry } from "./provider.js";
import { LeaseManager } from "./leases.js";
import { resolveConfig } from "./config.js";
import type { WorkspaceBinding } from "./types.js";

function binding(overrides: Partial<WorkspaceBinding> = {}): WorkspaceBinding {
  return {
    workspaceID: "ws1",
    provider: "default",
    host: "host1",
    remotePort: 39217,
    localPort: 39300,
    token: "token-123",
    leaseMode: "exclusive",
    status: "ready",
    ...overrides,
  };
}

function withTempHome<T>(fn: () => T): T {
  const home = mkdtempSync(join(tmpdir(), "opencode-remote-state-test-"));
  const prevHome = process.env.HOME;
  const prevStateFile = process.env.OPENCODE_REMOTE_STATE_FILE;
  process.env.HOME = home;
  // RuntimeState resolves its path per construction, so redirect it at the
  // temp home instead of the live plugin state file.
  process.env.OPENCODE_REMOTE_STATE_FILE = join(home, ".config", "opencode", "opencode-remote-state.json");
  try {
    return fn();
  } finally {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    if (prevStateFile === undefined) {
      delete process.env.OPENCODE_REMOTE_STATE_FILE;
    } else {
      process.env.OPENCODE_REMOTE_STATE_FILE = prevStateFile;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function testRuntimeStatePersistsBindings() {
  withTempHome(() => {
    const state = new RuntimeState();
    state.set(binding());

    const reloaded = new RuntimeState();
    const got = reloaded.get("ws1");
    assert(got, "expected persisted binding to reload");
    assert(got.localPort === 39300, `expected localPort 39300, got ${got.localPort}`);
    assert(got.token === "token-123", `expected token to persist, got ${got.token}`);
  });
}

function testRuntimeStateDeletePersistsRemoval() {
  withTempHome(() => {
    const state = new RuntimeState();
    state.set(binding());
    state.delete("ws1");

    const reloaded = new RuntimeState();
    assert(!reloaded.get("ws1"), "expected deleted binding to stay deleted after reload");
  });
}

function testRuntimeStateReplaceUpdatesPersistedBinding() {
  withTempHome(() => {
    const state = new RuntimeState();
    state.set(binding());
    state.replace(binding({ localPort: 39301, tunnelPID: 12345 }));

    const reloaded = new RuntimeState();
    const got = reloaded.get("ws1");
    assert(got, "expected replaced binding to reload");
    assert(got.localPort === 39301, `expected updated localPort 39301, got ${got.localPort}`);
    assert(got.tunnelPID === 12345, `expected tunnelPID 12345, got ${got.tunnelPID}`);
  });
}

function testRuntimeStateIgnoresMalformedPersistedState() {
  withTempHome(() => {
    const stateFile = process.env.OPENCODE_REMOTE_STATE_FILE!;
    mkdirSync(join(stateFile, ".."), { recursive: true });
    writeFileSync(stateFile, "{not json", "utf8");

    const state = new RuntimeState();
    assert(state.list().length === 0, "expected malformed state file to load as empty");
  });
}

function testProviderRegistryResolvesBySshHost() {
  const registry = new ProviderRegistry(
    resolveConfig({
      providers: {
        default: {
          hosts: [
            {
              name: "prod-web-1",
              aliases: ["primary-web"],
              ssh: {
                host: "203.0.113.10",
                user: "ops",
              },
            },
          ],
        },
      },
    }),
    new LeaseManager(),
  );

  const byIp = registry.resolve({ provider: "default", host: "203.0.113.10" });
  assert(byIp.host.name === "prod-web-1", `expected ssh.host lookup to resolve prod-web-1, got ${byIp.host.name}`);

  const byAlias = registry.resolve({ provider: "default", host: "primary-web" });
  assert(byAlias.host.name === "prod-web-1", `expected alias lookup to resolve prod-web-1, got ${byAlias.host.name}`);
}

function testProviderRegistryAllowsSameWorkspaceToReuseExplicitLease() {
  const leases = new LeaseManager();
  const registry = new ProviderRegistry(
    resolveConfig({
      providers: {
        default: {
          hosts: [
            {
              name: "prod-web-1",
              aliases: ["primary-web"],
              ssh: {
                host: "203.0.113.10",
                user: "ops",
              },
            },
          ],
        },
      },
    }),
    leases,
  );

  const first = registry.acquireResolved({ provider: "default", host: "prod-web-1" }, "ws1");
  assert(first.host.name === "prod-web-1", `expected first lease to resolve prod-web-1, got ${first.host.name}`);

  const reused = registry.acquireResolved({ provider: "default", host: "prod-web-1" }, "ws1");
  assert(reused.host.name === "prod-web-1", `expected same workspace to reuse explicit lease, got ${reused.host.name}`);

  const reusedByIp = registry.acquireResolved({ provider: "default", host: "203.0.113.10" }, "ws1");
  assert(reusedByIp.host.name === "prod-web-1", `expected same workspace to reuse explicit lease by ssh.host, got ${reusedByIp.host.name}`);

  const reusedByAlias = registry.acquireResolved({ provider: "default", host: "primary-web" }, "ws1");
  assert(reusedByAlias.host.name === "prod-web-1", `expected same workspace to reuse explicit lease by alias, got ${reusedByAlias.host.name}`);
}

function testProviderRegistryReclaimsStaleLeaseButHonorsLiveOnes() {
  const leases = new LeaseManager();
  const liveWorkspaces = new Set<string>(["ws-live"]);
  const registry = new ProviderRegistry(
    resolveConfig({
      providers: {
        default: {
          hosts: [
            {
              name: "prod-web-1",
              ssh: {
                host: "203.0.113.10",
                user: "ops",
              },
            },
          ],
        },
      },
    }),
    leases,
    (workspaceID) => liveWorkspaces.has(workspaceID),
  );

  // A lease backed by a live workspace must still block other workspaces.
  leases.acquire("prod-web-1", "ws-live", "exclusive");
  let blocked = false;
  try {
    registry.acquireResolved({ provider: "default", host: "prod-web-1" }, "ws-new");
  } catch {
    blocked = true;
  }
  assert(blocked, "expected live lease held by another workspace to block acquisition");

  // A lease with no live binding behind it (e.g. interrupted tool call) is
  // reclaimed so the host becomes usable again without a restart.
  leases.release("prod-web-1", "ws-live");
  leases.acquire("prod-web-1", "ws-interrupted", "exclusive");
  const reclaimed = registry.acquireResolved({ provider: "default", host: "prod-web-1" }, "ws-new");
  assert(reclaimed.host.name === "prod-web-1", `expected stale lease to be reclaimed, got ${reclaimed.host.name}`);
  assert(
    leases.get("prod-web-1")?.workspaceID === "ws-new",
    `expected reclaimed lease to belong to ws-new, got ${leases.get("prod-web-1")?.workspaceID}`,
  );
}

function run() {
  testRuntimeStatePersistsBindings();
  testRuntimeStateDeletePersistsRemoval();
  testRuntimeStateReplaceUpdatesPersistedBinding();
  testRuntimeStateIgnoresMalformedPersistedState();
  testProviderRegistryResolvesBySshHost();
  testProviderRegistryAllowsSameWorkspaceToReuseExplicitLease();
  testProviderRegistryReclaimsStaleLeaseButHonorsLiveOnes();
  console.log("state.test.ts: ok");
}

run();
