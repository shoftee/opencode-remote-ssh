import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkspaceBinding } from "./types.js";

function resolveStateFile(): string {
  // Tests (and unusual deployments) point this at an isolated path; resolving
  // per construction lets suites redirect it after module import.
  const override = process.env.OPENCODE_REMOTE_STATE_FILE;
  if (override) {
    return override;
  }
  const home = homedir();
  if (home) {
    return join(home, ".config", "opencode", "opencode-remote-state.json");
  }
  return join(tmpdir(), "opencode-remote-state.json");
}

export class RuntimeState {
  private readonly bindings = new Map<string, WorkspaceBinding>();
  private readonly stateFile: string;

  constructor() {
    this.stateFile = resolveStateFile();
    this.load();
  }

  set(binding: WorkspaceBinding): void {
    this.bindings.set(binding.workspaceID, binding);
    this.save();
  }

  get(workspaceID: string): WorkspaceBinding | undefined {
    return this.bindings.get(workspaceID);
  }

  delete(workspaceID: string): void {
    this.bindings.delete(workspaceID);
    this.save();
  }

  list(): WorkspaceBinding[] {
    return Array.from(this.bindings.values());
  }

  replace(binding: WorkspaceBinding): void {
    this.bindings.set(binding.workspaceID, binding);
    this.save();
  }

  private load(): void {
    if (!existsSync(this.stateFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const item of parsed) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const binding = item as WorkspaceBinding;
        if (!binding.workspaceID || !binding.provider || !binding.host || !binding.token) {
          continue;
        }
        this.bindings.set(binding.workspaceID, binding);
      }
    } catch {
      // Ignore malformed persisted state rather than failing plugin startup.
    }
  }

  private save(): void {
    const dir = dirname(this.stateFile);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(Array.from(this.bindings.values()), null, 2), { mode: 0o600 });
    chmodSync(this.stateFile, 0o600);
  }
}
