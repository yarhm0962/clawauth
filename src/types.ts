export interface ScriptProtectionConfig {
  autoObfuscate: boolean;
  controlFlowFlattening: boolean;
  antiTamper: boolean;
  antiEnvLogs: boolean;
  stringEncryption: boolean;
  junkOpcodes: boolean;
}

export interface ScriptVersion {
  version: string;
  code: string;
  obfuscatedCode?: string;
  note: string;
  createdAt: string;
  bytes: number;
}

export interface HostedScript {
  id: string;
  loaderId: string;
  title: string;
  slug: string;
  description: string;
  domain: string;
  visibility: 'public' | 'unlisted' | 'protected';
  accessKey: string;
  code: string;
  obfuscatedCode: string;
  protection: ScriptProtectionConfig;
  checksumHash: string;
  version: string;
  pinned: boolean;
  pulls: number;
  executions: number;
  bytes: number;
  obfuscatedBytes: number;
  createdAt: string;
  updatedAt: string;
  versions: ScriptVersion[];
}

export interface CustomDomain {
  id: string;
  hostname: string;
  isDefault: boolean;
  sslEnabled: boolean;
  corsEnabled: boolean;
  cacheTtlSeconds: number;
  requestsServed: number;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  type: 'RAW_FETCH' | 'REMOTE_EXEC' | 'SCRIPT_DEPLOY' | 'DOMAIN_ROUTE';
  method: 'GET' | 'POST' | 'PUT';
  endpoint: string;
  domain: string;
  scriptSlug: string;
  status: number;
  latencyMs: number;
  bytes: number;
  detail: string;
}

export interface StoreState {
  apiKey: string;
  scripts: HostedScript[];
  domains: CustomDomain[];
  logs: ActivityLog[];
}

export interface ExecutionStdoutLine {
  level: 'info' | 'warn' | 'return' | 'error';
  message: string;
  timestamp: string;
}

export interface ExecutionResult {
  ok: boolean;
  stdout: ExecutionStdoutLine[];
  returnValue: string | null;
  durationMs: number;
  bytesExecuted: number;
  resolvedEndpoint: string;
  scriptSlug: string | null;
  scriptExecutions: number | null;
}

export type LoadstringMode = 'luarmor' | 'custom' | 'live' | 'smart';

export type WorkspaceTab = 'studio' | 'scripts' | 'execution' | 'domains' | 'activity';
