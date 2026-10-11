export type SelectionStrategy = "first_available";

export type LeaseMode = "exclusive" | "shared";

export interface SSHConfig {
  host: string;
  user: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

export interface HostConfig {
  name: string;
  aliases?: string[];
  ssh: SSHConfig;
  labels?: string[];
}

export interface ProviderConfig {
  strategy?: SelectionStrategy;
  labels?: string[];
  hosts: HostConfig[];
}

export interface TunnelConfig {
  localPortRange?: [number, number];
  connectTimeoutMs?: number;
  healthTimeoutMs?: number;
}

export interface DefaultsConfig {
  selectionStrategy?: SelectionStrategy;
  leaseMode?: LeaseMode;
  stubPort?: number;
}

export interface PluginConfig {
  installRoot?: string;
  stubBinaryPath?: string;
  tunnel?: TunnelConfig;
  defaults?: DefaultsConfig;
  providers?: Record<string, ProviderConfig>;
}

export interface ResolvedHost {
  provider: string;
  host: HostConfig;
  labels: string[];
  strategy: SelectionStrategy;
}

export interface LeaseRecord {
  host: string;
  workspaceID: string;
  mode: LeaseMode;
  acquiredAt: number;
}

export interface WorkspaceBinding {
  workspaceID: string;
  provider: string;
  host: string;
  remotePort: number;
  localPort: number;
  token: string;
  leaseMode: LeaseMode;
  status: "creating" | "ready" | "failed" | "removed";
  tunnelPID?: number;
  sessionID?: string;
}

export interface WorkspaceInfo {
  id: string;
  type: string;
  name?: string;
  branch?: string | null;
  directory?: string | null;
  extra?: Record<string, unknown> | null;
  projectID?: string;
}

export interface WorkspaceTarget {
  type: "remote";
  url: string;
  headers: Record<string, string>;
}

// OpenCode 2.x has no workspace-adapter registration API, so this shape is kept
// locally for the adapter below; the tools drive the same operations instead.
export interface WorkspaceAdapter {
  name: string;
  description: string;
  configure(workspace: WorkspaceInfo): WorkspaceInfo;
  create(workspace: WorkspaceInfo): Promise<void>;
  remove(workspace: WorkspaceInfo): Promise<void>;
  target(workspace: WorkspaceInfo): Promise<WorkspaceTarget>;
}
