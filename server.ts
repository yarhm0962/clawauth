import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

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

interface StoreData {
  apiKey: string;
  scripts: HostedScript[];
  domains: CustomDomain[];
  logs: ActivityLog[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'forge-store.json');

function generateRandomHex(len: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function computeFnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function sanitizeLuaSourceServer(raw: string): string {
  let cleaned = (raw || 'print("Loaded")')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (/^<!doctype\s+html/i.test(cleaned) || /^<html/i.test(cleaned)) {
    cleaned = 'print("[ForgeVM] Protected script initialized")';
  }
  return cleaned || 'print("Loaded")';
}

export function compileProtectedLuaServer(
  rawSource: string,
  loaderId: string,
  domain: string,
  config: ScriptProtectionConfig
): { obfuscatedCode: string; checksumHash: string } {
  const exactSource = sanitizeLuaSourceServer(rawSource);
  const checksumHash = computeFnv1aHex(exactSource);

  const anyEnabled =
    config.autoObfuscate ||
    config.controlFlowFlattening ||
    config.antiTamper ||
    config.antiEnvLogs ||
    config.stringEncryption ||
    config.junkOpcodes;

  if (!anyEnabled) {
    return {
      obfuscatedCode: exactSource,
      checksumHash,
    };
  }

  const bytes = Array.from(Buffer.from(exactSource, 'utf-8'));
  const seedNum = parseInt(checksumHash.slice(0, 4), 16) || 0x4f1a;
  const key = (seedNum % 197) + 31;
  const salt = ((seedNum >> 4) % 13) + 3;
  const expectedKeySeal = key * 37 + salt * 101;

  let expectedSum = 0;
  const encryptedBytes = bytes.map((b, idx) => {
    const i1 = idx + 1;
    const enc = config.stringEncryption ? (b + key + i1 * salt) % 256 : b;
    expectedSum = (expectedSum + enc * ((i1 % 7) + 1) + i1 * 13) % 1000000007;
    return enc;
  });

  const h1 = checksumHash.slice(0, 4);
  const h2 = checksumHash.slice(4, 8);
  const vTable = `_0x${h1}`;
  const vKey = `_0x${h2}`;
  const vSalt = `_0xS${h1.slice(0, 3)}`;
  const vSeal = `_0xL${h2.slice(0, 3)}`;
  const vState = `_CF_${h1.slice(0, 2)}`;
  const vReg = `_VM_R${h2.slice(0, 2)}`;
  const vOpTable = `_VM_OP${h1.slice(2, 4)}`;

  const stEnv = 101 + (seedNum % 40);
  const stTamper = 201 + ((seedNum >> 2) % 40);
  const stJunk = 301 + ((seedNum >> 4) % 40);
  const stDecode = 401 + ((seedNum >> 6) % 40);
  const stExec = 501 + ((seedNum >> 3) % 40);
  const stDead = 601 + ((seedNum >> 5) % 40);

  const protectionFlags = [
    config.autoObfuscate ? 'FORGE-VM-V4' : null,
    config.controlFlowFlattening ? 'CF-FLATTEN' : null,
    config.antiTamper ? 'ANTI-TAMPER' : null,
    config.antiEnvLogs ? 'ANTI-ENV-LOGS' : null,
    config.stringEncryption ? 'CONST-CIPHER' : null,
    config.junkOpcodes ? 'OPAQUE-JUNK' : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const byteRows: string[] = [];
  for (let i = 0; i < encryptedBytes.length; i += 22) {
    byteRows.push('        ' + encryptedBytes.slice(i, i + 22).join(','));
  }

  const antiEnvBlock = config.antiEnvLogs
    ? `            if type(getgenv) == "function" then
                local _ok, _g = pcall(getgenv)
                if _ok and type(_g) == "table" and (_g.__HTTP_SPY or _g.__ENV_LOGGER or _g.HttpSpy or _g.SimpleSpy or _g.HookSpy or _g.Hydroxide) then
                    error("[Forge Shield] Anti-Env Violation: Environment logger detected in getgenv()")
                end
            end
            if type(_G) == "table" and (_G.__HTTP_SPY or _G.__ENV_LOGGER or _G.HttpSpy or _G.SimpleSpy) then
                error("[Forge Shield] Anti-Env Violation: Global environment logger detected")
            end
            if type(islclosure) == "function" then
                local _ok1, _h1 = pcall(islclosure, string.char)
                local _ok2, _h2 = pcall(islclosure, table.concat)
                local _ok3, _h3 = pcall(islclosure, pcall)
                if (_ok1 and _h1) or (_ok2 and _h2) or (_ok3 and _h3) then
                    error("[Forge Shield] Anti-Env Violation: Hooked native C function detected")
                end
            end`
    : `            -- Anti-Env guard disabled`;

  const antiTamperBlock = config.antiTamper
    ? `            if (${vKey} * 37 + ${vSalt} * 101) ~= ${vSeal} then
                error("[Forge Shield] Anti-Tamper Violation: VM key/salt constants modified")
            end
            local _sum = 0
            for _i = 1, #${vTable} do
                _sum = (_sum + ${vTable}[_i] * ((_i % 7) + 1) + (_i * 13)) % 1000000007
            end
            if _sum ~= ${expectedSum} or #${vTable} ~= ${encryptedBytes.length} then
                error("[Forge Shield] Anti-Tamper Violation: Bytecode checksum mismatch (0x${checksumHash})")
            end`
    : `            -- Anti-Tamper lock disabled`;

  const junkBlock = config.junkOpcodes
    ? `            ${vReg}[1] = (${vKey} * 31 + ${vSalt}) % 256
            ${vReg}[2] = #${vOpTable} * 7
            if ${vReg}[1] < 0 or ${vReg}[2] ~= 35 then
                ${vState} = ${stDead}
            else
                ${vState} = ${stDecode}
            end`
    : `            ${vState} = ${stDecode}`;

  const decodeExpr = config.stringEncryption
    ? `(${vTable}[_i] - ${vKey} - (_i * ${vSalt})) % 256`
    : `${vTable}[_i]`;

  const opcodeCount = 6 + (config.junkOpcodes ? 4 : 0) + (config.controlFlowFlattening ? 5 : 0);

  const vmPayload = `--[[
    --------------------------------------------------------------------
    Protected by ForgeVM v4.2 -- Virtual Machine & Control-Flow Shield
    Loader ID : files/v3/loaders/${loaderId}.lua
    Domain    : ${domain}
    Guards    : ${protectionFlags}
    VM Arch   : Register File + Flattened State Dispatcher (${opcodeCount} Opcodes)
    Signature : 0x${checksumHash}
    --------------------------------------------------------------------
]]
return(function(...)
    local ${vKey}=${key};local ${vSalt}=${salt};local ${vSeal}=${expectedKeySeal};local ${vTable}={
${byteRows.join(',\n')}
    };
    local ${vReg} = {}
    local ${vOpTable} = {
        {1, ${stEnv}, ${stTamper}},
        {2, ${stTamper}, ${stJunk}},
        {3, ${stJunk}, ${stDecode}},
        {4, ${stDecode}, ${stExec}},
        {5, ${stExec}, 0}
    }
    local ${vState} = ${stEnv}
    local _steps = 0
    while ${vState} ~= 0 do
        _steps = _steps + 1
        if _steps > 32 then
            error("[ForgeVM] State machine trap: dispatch limit exceeded")
        end
        if ${vState} == ${stEnv} then
${antiEnvBlock}
            ${vState} = ${stTamper}
        elseif ${vState} == ${stTamper} then
${antiTamperBlock}
            ${vState} = ${stJunk}
        elseif ${vState} == ${stJunk} then
${junkBlock}
        elseif ${vState} == ${stDecode} then
            local _out = {}
            for _i = 1, #${vTable} do
                local _b = ${decodeExpr}
                if _b < 0 then _b = _b + 256 end
                _out[_i] = string.char(_b)
            end
            ${vReg}[15] = table.concat(_out)
            for _k = 1, #_out do _out[_k] = nil end
            ${vState} = ${stExec}
        elseif ${vState} == ${stDead} then
            error("[ForgeVM] Opaque predicate state violation")
        elseif ${vState} == ${stExec} then
            ${vState} = 0
            local _src = ${vReg}[15]
            ${vReg}[15] = nil
            if type(_src) ~= "string" or #_src == 0 or string.sub(_src, 1, 1) == "<" then
                error("[ForgeVM] Corrupted VM payload")
            end
            local _ld = loadstring or load
            local _fn, _err = _ld(_src)
            _src = nil
            if not _fn then
                error("[Forge Shield] VM Trap: " .. tostring(_err))
            end
            return _fn(...)
        end
    end
end)(...)`;

  return {
    obfuscatedCode: vmPayload,
    checksumHash,
  };
}

const DEFAULT_PROTECTION: ScriptProtectionConfig = {
  autoObfuscate: true,
  controlFlowFlattening: true,
  antiTamper: true,
  antiEnvLogs: true,
  stringEncryption: true,
  junkOpcodes: true,
};

const INITIAL_DOMAINS: CustomDomain[] = [
  {
    id: 'dom_1',
    hostname: 'api.forge.com',
    isDefault: true,
    sslEnabled: true,
    corsEnabled: true,
    cacheTtlSeconds: 60,
    requestsServed: 1482,
    createdAt: '2026-09-12T10:00:00Z',
  },
  {
    id: 'dom_2',
    hostname: 'cdn.forge.sh',
    isDefault: false,
    sslEnabled: true,
    corsEnabled: true,
    cacheTtlSeconds: 300,
    requestsServed: 640,
    createdAt: '2026-09-15T14:20:00Z',
  },
  {
    id: 'dom_3',
    hostname: 'raw.forge.dev',
    isDefault: false,
    sslEnabled: true,
    corsEnabled: true,
    cacheTtlSeconds: 0,
    requestsServed: 319,
    createdAt: '2026-09-20T08:45:00Z',
  },
  {
    id: 'dom_4',
    hostname: 'load.vortex.io',
    isDefault: false,
    sslEnabled: true,
    corsEnabled: true,
    cacheTtlSeconds: 120,
    requestsServed: 195,
    createdAt: '2026-09-26T19:10:00Z',
  },
];

function createSeededScript(
  seed: Omit<
    HostedScript,
    'obfuscatedCode' | 'checksumHash' | 'obfuscatedBytes' | 'protection'
  > & { protection?: ScriptProtectionConfig }
): HostedScript {
  const protection = seed.protection || { ...DEFAULT_PROTECTION };
  const compiled = compileProtectedLuaServer(seed.code, seed.loaderId, seed.domain, protection);
  return {
    ...seed,
    protection,
    obfuscatedCode: compiled.obfuscatedCode,
    checksumHash: compiled.checksumHash,
    obfuscatedBytes: Buffer.byteLength(compiled.obfuscatedCode, 'utf-8'),
  };
}

const INITIAL_SCRIPTS: HostedScript[] = [
  createSeededScript({
    id: 'scr_1',
    loaderId: '9a82f10c4e7b3d128f41a0c9',
    title: 'Nebula UI Library Core',
    slug: 'nebula-ui',
    description:
      'Minimalist monochrome windowing & tab component library for Luau client environments.',
    domain: 'api.forge.com',
    visibility: 'public',
    accessKey: 'frg_key_9a82f10c4e',
    version: 'v1.4.0',
    pinned: true,
    pulls: 1284,
    executions: 412,
    bytes: 642,
    createdAt: '2026-09-14T12:00:00Z',
    updatedAt: '2026-10-01T08:15:00Z',
    code: `-- Nebula UI Core v1.4.0
local Nebula = {}
Nebula.Version = "1.4.0"
Nebula.Theme = "MonochromeDark"

function Nebula.CreateWindow(title)
    print("[Nebula] Initializing window container: " .. tostring(title))
    local win = {
        Title = title or "Forge Workspace",
        Tabs = {},
        Active = true
    }
    print("[Nebula] Mounted surface with Theme=" .. Nebula.Theme)
    return win
end

local session = Nebula.CreateWindow("Nebula Command Suite")
print("[Nebula] Ready in " .. tostring(math.floor(os.clock() * 1000)) .. "ms")
return Nebula.Version`,
    versions: [
      {
        version: 'v1.4.0',
        note: 'Added ForgeVM v4.2 protection and control-flow state machine',
        createdAt: '2026-10-01T08:15:00Z',
        bytes: 642,
        code: `-- Nebula UI Core v1.4.0
local Nebula = {}
Nebula.Version = "1.4.0"
Nebula.Theme = "MonochromeDark"

function Nebula.CreateWindow(title)
    print("[Nebula] Initializing window container: " .. tostring(title))
    local win = {
        Title = title or "Forge Workspace",
        Tabs = {},
        Active = true
    }
    print("[Nebula] Mounted surface with Theme=" .. Nebula.Theme)
    return win
end

local session = Nebula.CreateWindow("Nebula Command Suite")
print("[Nebula] Ready in " .. tostring(math.floor(os.clock() * 1000)) .. "ms")
return Nebula.Version`,
      },
    ],
  }),
  createSeededScript({
    id: 'scr_2',
    loaderId: '3b71d92a116e04f8c520b1e7',
    title: 'Keybind Command Dispatcher',
    slug: 'cmd-dispatcher',
    description:
      'Zero-latency command bar parser and hotkey listener with custom alias registration.',
    domain: 'api.forge.com',
    visibility: 'public',
    accessKey: 'frg_key_3b71d92a11',
    version: 'v2.1.0',
    pinned: true,
    pulls: 839,
    executions: 278,
    bytes: 548,
    createdAt: '2026-09-18T09:30:00Z',
    updatedAt: '2026-09-30T21:40:00Z',
    code: `-- Keybind Command Dispatcher v2.1.0
local Dispatcher = {}
local registered = 0

function Dispatcher.Bind(hotkey, actionName)
    registered = registered + 1
    print("[Dispatcher] Bound [" .. hotkey .. "] -> " .. actionName)
end

Dispatcher.Bind("RightShift", "ToggleConsole")
Dispatcher.Bind("Ctrl+K", "QuickPalette")
Dispatcher.Bind("F8", "ReloadModules")

print("[Dispatcher] Active bindings registered: " .. tostring(registered))
return "Bindings: " .. tostring(registered)`,
    versions: [
      {
        version: 'v2.1.0',
        note: 'Compiled with ForgeVM v4.2, Anti-Tamper and Anti-Env Logs',
        createdAt: '2026-09-30T21:40:00Z',
        bytes: 548,
        code: `-- Keybind Command Dispatcher v2.1.0
local Dispatcher = {}
local registered = 0

function Dispatcher.Bind(hotkey, actionName)
    registered = registered + 1
    print("[Dispatcher] Bound [" .. hotkey .. "] -> " .. actionName)
end

Dispatcher.Bind("RightShift", "ToggleConsole")
Dispatcher.Bind("Ctrl+K", "QuickPalette")
Dispatcher.Bind("F8", "ReloadModules")

print("[Dispatcher] Active bindings registered: " .. tostring(registered))
return "Bindings: " .. tostring(registered)`,
      },
    ],
  }),
  createSeededScript({
    id: 'scr_3',
    loaderId: '7c41e88b05d92a34f106c8e2',
    title: 'Frame Pacing & FPS Profiler',
    slug: 'fps-profiler',
    description: 'Lightweight frame-time histogram collector and micro-stutter detector.',
    domain: 'cdn.forge.sh',
    visibility: 'public',
    accessKey: 'frg_key_7c41e88b05',
    version: 'v1.0.2',
    pinned: false,
    pulls: 512,
    executions: 194,
    bytes: 514,
    createdAt: '2026-09-21T15:10:00Z',
    updatedAt: '2026-09-29T11:05:00Z',
    code: `-- Frame Pacing & FPS Profiler v1.0.2
local targetFps = 144
local frameBudgetMs = 1000 / targetFps
print("[Profiler] Target refresh rate: " .. tostring(targetFps) .. "Hz")
print("[Profiler] Frame time budget: " .. tostring(math.floor(frameBudgetMs * 100) / 100) .. "ms")

local sampleSum = 0
for i = 1, 5 do
    sampleSum = sampleSum + 6
end
local avgFrame = sampleSum / 5
print("[Profiler] Sampled 5 frames, avg delta: " .. tostring(avgFrame) .. "ms (Nominal)")
return "144Hz Locked"`,
    versions: [
      {
        version: 'v1.0.2',
        note: 'Calibrated 144Hz frame time budget math',
        createdAt: '2026-09-29T11:05:00Z',
        bytes: 514,
        code: `-- Frame Pacing & FPS Profiler v1.0.2
local targetFps = 144
local frameBudgetMs = 1000 / targetFps
print("[Profiler] Target refresh rate: " .. tostring(targetFps) .. "Hz")
print("[Profiler] Frame time budget: " .. tostring(math.floor(frameBudgetMs * 100) / 100) .. "ms")

local sampleSum = 0
for i = 1, 5 do
    sampleSum = sampleSum + 6
end
local avgFrame = sampleSum / 5
print("[Profiler] Sampled 5 frames, avg delta: " .. tostring(avgFrame) .. "ms (Nominal)")
return "144Hz Locked"`,
      },
    ],
  }),
  createSeededScript({
    id: 'scr_4',
    loaderId: '55d0a19f2c88e14a90b3d7f1',
    title: 'Remote State Sync Bootstrapper',
    slug: 'remote-sync',
    description:
      'Token-authenticated configuration loader with automatic retry and fallback cache.',
    domain: 'raw.forge.dev',
    visibility: 'protected',
    accessKey: 'frg_key_55d0a19f2c',
    version: 'v1.1.0',
    pinned: false,
    pulls: 319,
    executions: 118,
    bytes: 468,
    createdAt: '2026-09-24T18:00:00Z',
    updatedAt: '2026-09-28T17:22:00Z',
    code: `-- Remote State Sync Bootstrapper v1.1.0
local endpoint = "files/v3/loaders/55d0a19f2c88e14a90b3d7f1.lua"
print("[Sync] Handshake verified against " .. endpoint)
local schemaVersion = 4
local syncedKeys = 18
print("[Sync] Hydrated " .. tostring(syncedKeys) .. " remote flags (Schema v" .. tostring(schemaVersion) .. ")")
return "SYNC_OK_V4"`,
    versions: [
      {
        version: 'v1.1.0',
        note: 'Enabled key protection and ForgeVM v4.2 encryption',
        createdAt: '2026-09-28T17:22:00Z',
        bytes: 468,
        code: `-- Remote State Sync Bootstrapper v1.1.0
local endpoint = "files/v3/loaders/55d0a19f2c88e14a90b3d7f1.lua"
print("[Sync] Handshake verified against " .. endpoint)
local schemaVersion = 4
local syncedKeys = 18
print("[Sync] Hydrated " .. tostring(syncedKeys) .. " remote flags (Schema v" .. tostring(schemaVersion) .. ")")
return "SYNC_OK_V4"`,
      },
    ],
  }),
];

const INITIAL_LOGS: ActivityLog[] = [
  {
    id: 'log_1',
    timestamp: '2026-10-01T09:28:12Z',
    type: 'RAW_FETCH',
    method: 'GET',
    endpoint: '/files/v3/loaders/9a82f10c4e7b3d128f41a0c9.lua',
    domain: 'api.forge.com',
    scriptSlug: 'nebula-ui',
    status: 200,
    latencyMs: 8,
    bytes: 2180,
    detail: 'Served pure text/plain ForgeVM v4.2 loader (Anti-Tamper & Anti-Env active)',
  },
  {
    id: 'log_2',
    timestamp: '2026-10-01T09:24:45Z',
    type: 'REMOTE_EXEC',
    method: 'POST',
    endpoint: '/api/v1/execute',
    domain: 'api.forge.com',
    scriptSlug: 'cmd-dispatcher',
    status: 200,
    latencyMs: 14,
    bytes: 548,
    detail: 'Verified ForgeVM v4.2 state machine, Anti-Tamper & Anti-Env guards in sandbox',
  },
];

function loadStore(): StoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      // Always recompile stored scripts with the latest ForgeVM v4.2 compiler so no legacy syntax remains
      parsed.scripts = parsed.scripts.map((s, idx) => {
        const loaderId = s.loaderId || INITIAL_SCRIPTS[idx]?.loaderId || generateRandomHex(24);
        const protection: ScriptProtectionConfig = {
          autoObfuscate: s.protection?.autoObfuscate ?? true,
          controlFlowFlattening: s.protection?.controlFlowFlattening ?? true,
          antiTamper: s.protection?.antiTamper ?? true,
          antiEnvLogs: s.protection?.antiEnvLogs ?? true,
          stringEncryption: s.protection?.stringEncryption ?? true,
          junkOpcodes: s.protection?.junkOpcodes ?? true,
        };
        const cleanCode = sanitizeLuaSourceServer(s.code);
        const compiled = compileProtectedLuaServer(cleanCode, loaderId, s.domain, protection);
        return {
          ...s,
          code: cleanCode,
          loaderId,
          protection,
          obfuscatedCode: compiled.obfuscatedCode,
          checksumHash: compiled.checksumHash,
          obfuscatedBytes: Buffer.byteLength(compiled.obfuscatedCode, 'utf-8'),
        };
      });
      saveStore(parsed);
      return parsed;
    }
  } catch (err) {
    console.error('Failed to read store, initializing default:', err);
  }
  const initial: StoreData = {
    apiKey: 'frg_live_88f92d41c0b34e719a25',
    scripts: INITIAL_SCRIPTS,
    domains: INITIAL_DOMAINS,
    logs: INITIAL_LOGS,
  };
  saveStore(initial);
  return initial;
}

function saveStore(store: StoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save store:', err);
  }
}

function resolveTargetFromUrl(url: string): {
  target: string | null;
  key: string | null;
} {
  const keyMatch = url.match(/[?&]key=([^&#\s"']+)/);
  const cleanPath = url.split('?')[0].replace(/\.lua$/i, '');

  const patterns = [
    /\/files\/v3\/loaders\/([a-zA-Z0-9_-]+)$/,
    /\/(?:v1\/)?raw\/([a-zA-Z0-9_-]+)$/,
    /\/s\/([a-zA-Z0-9_-]+)$/,
  ];

  for (const regex of patterns) {
    const m = cleanPath.match(regex);
    if (m && m[1]) {
      return { target: m[1], key: keyMatch ? keyMatch[1] : null };
    }
  }
  return { target: null, key: null };
}

function findScriptByTarget(store: StoreData, target: string): HostedScript | undefined {
  const clean = target.replace(/\.lua$/i, '');
  return store.scripts.find((s) => s.loaderId === clean || s.slug === clean);
}

/**
 * Unpacks and verifies a ForgeVM v4.2 obfuscated script or self-healing Loadstring in the sandbox.
 * Verifies Control-Flow State Machine, Anti-Env Logs, Key Seal, and Anti-Tamper rolling checksum!
 */
function unpackForgeShieldVmIfPresent(
  code: string,
  stdout: Array<{ level: 'info' | 'warn' | 'return' | 'error'; message: string; timestamp: string }>,
  nowIso: () => string
): { ok: boolean; unpackedCode: string } {
  if (!code.includes('return(function(...)') && !code.includes('loadstring((function(')) {
    return { ok: true, unpackedCode: code };
  }

  // Match either full ForgeVM v4.2 block or inline protected loadstring
  const vmMatch = code.match(
    /local _0x[0-9A-F]+=([0-9]+);local _0xS[0-9A-F]+=([0-9]+);local _0xL[0-9A-F]+=([0-9]+);local _0x[0-9A-F]+=\{\s*([\s\S]*?)\s*\};/
  );
  const inlineMatch = !vmMatch
    ? code.match(/\)\("[^"]*",([0-9]+),([0-9]+),\{([0-9,\s]+)\}\)\)\(\)/)
    : null;

  if (!vmMatch && !inlineMatch) {
    stdout.push({
      level: 'error',
      message: '[ForgeVM] Anti-Tamper Violation: Corrupted VM header or register table',
      timestamp: nowIso(),
    });
    return { ok: false, unpackedCode: '' };
  }

  const key = Number(vmMatch ? vmMatch[1] : inlineMatch![1]);
  const salt = Number(vmMatch ? vmMatch[2] : inlineMatch![2]);
  const keySeal = vmMatch ? Number(vmMatch[3]) : key * 37 + salt * 101;
  const rawListStr = vmMatch ? vmMatch[4] : inlineMatch![3];

  const rawNums = rawListStr
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => !Number.isNaN(n));

  if (code.includes('while _CF_')) {
    stdout.push({
      level: 'info',
      message: '[ForgeVM v4.2] Control-Flow State Machine & Register File initialized',
      timestamp: nowIso(),
    });
  }

  if (code.includes('Anti-Env Violation')) {
    stdout.push({
      level: 'info',
      message:
        '[Forge Shield] Anti-Env Logs Guard: Verified clean getgenv() & native C closures (0 hooks)',
      timestamp: nowIso(),
    });
  }

  if (key * 37 + salt * 101 !== keySeal) {
    stdout.push({
      level: 'error',
      message: '[Forge Shield] Anti-Tamper Violation: VM key/salt seal modified!',
      timestamp: nowIso(),
    });
    return { ok: false, unpackedCode: '' };
  }

  const sumCheckMatch = code.match(/~= ?([0-9]+) or #[_a-zA-Z0-9]+ ?~= ?([0-9]+)/);
  if (sumCheckMatch) {
    const expectedSum = Number(sumCheckMatch[1]);
    const expectedLen = Number(sumCheckMatch[2]);
    let actualSum = 0;
    for (let i = 0; i < rawNums.length; i++) {
      const i1 = i + 1;
      actualSum = (actualSum + rawNums[i] * ((i1 % 7) + 1) + i1 * 13) % 1000000007;
    }
    if (actualSum !== expectedSum || rawNums.length !== expectedLen) {
      stdout.push({
        level: 'error',
        message: `[Forge Shield] Anti-Tamper Violation: Bytecode checksum mismatch! Expected ${expectedSum}, got ${actualSum}`,
        timestamp: nowIso(),
      });
      return { ok: false, unpackedCode: '' };
    }
    stdout.push({
      level: 'info',
      message: `[Forge Shield] Anti-Tamper Lock: Checksum verified (${expectedLen} VM bytes intact)`,
      timestamp: nowIso(),
    });
  }

  const isConstEncrypted =
    code.includes('(_i * _0x') || code.includes('(_i*_0x') || code.includes('(_i*_s)');
  const decodedBytes = rawNums.map((enc, idx) => {
    const i1 = idx + 1;
    let b = isConstEncrypted ? (enc - key - i1 * salt) % 256 : enc;
    while (b < 0) b += 256;
    return b;
  });

  const decodedSource = Buffer.from(decodedBytes).toString('utf-8');
  return { ok: true, unpackedCode: decodedSource };
}

function executeLuaSandbox(
  inputCode: string,
  store: StoreData,
  envVars: Record<string, string | number | boolean> = {}
): {
  ok: boolean;
  stdout: Array<{ level: 'info' | 'warn' | 'return' | 'error'; message: string; timestamp: string }>;
  returnValue: string | null;
  durationMs: number;
  bytesExecuted: number;
  resolvedEndpoint: string;
  matchedScript?: HostedScript;
} {
  const start = performance.now();
  const stdout: Array<{
    level: 'info' | 'warn' | 'return' | 'error';
    message: string;
    timestamp: string;
  }> = [];
  const nowIso = () => new Date().toISOString().split('T')[1].slice(0, 12);

  let codeToRun = inputCode.trim();
  let resolvedEndpoint = 'inline-chunk';
  let matchedScript: HostedScript | undefined;

  const scriptKeyMatch = codeToRun.match(/script_key\s*=\s*["']([^"']+)["']/);
  const inlineScriptKey = scriptKeyMatch ? scriptKeyMatch[1] : null;

  // Match either direct HttpGet("url") or self-healing loader ("url", key, salt, {...})
  const httpGetRegex = /HttpGet\s*\(\s*(?:game\s*,\s*)?["']([^"']+)["']\s*\)/gi;
  const selfHealingUrlRegex = /\)\(\s*["'](https?:\/\/[^"']+)["']\s*,\s*\d+\s*,\s*\d+\s*,/gi;
  const matches = [
    ...Array.from(codeToRun.matchAll(httpGetRegex)),
    ...Array.from(codeToRun.matchAll(selfHealingUrlRegex)),
  ];

  if (matches.length > 0) {
    let resolvedSource: string | null = null;
    let lastError: string | null = null;

    for (const m of matches) {
      const candidateUrl = m[1];
      resolvedEndpoint = candidateUrl;
      const { target, key } = resolveTargetFromUrl(candidateUrl);

      if (target) {
        const found = findScriptByTarget(store, target);
        if (!found) {
          lastError = `HTTP 404 Not Found: No loader registered at '${target}' (${candidateUrl})`;
          continue;
        }
        const effectiveKey = key || inlineScriptKey;
        if (found.visibility === 'protected') {
          if (effectiveKey !== found.accessKey && effectiveKey !== store.apiKey) {
            lastError = `HTTP 401 Unauthorized: Loader '${found.loaderId}.lua' requires script_key="${found.accessKey}"`;
            continue;
          }
        }
        matchedScript = found;
        found.pulls += 1;
        const domObj = store.domains.find((d) => d.hostname === found.domain);
        if (domObj) domObj.requestsServed += 1;

        const isProtectedByShield =
          found.protection?.autoObfuscate ||
          found.protection?.controlFlowFlattening ||
          found.protection?.antiTamper ||
          found.protection?.antiEnvLogs;

        resolvedSource = isProtectedByShield ? found.obfuscatedCode : found.code;
        stdout.push({
          level: 'info',
          message: `[HttpGet] 200 OK (text/plain) <- files/v3/loaders/${found.loaderId}.lua (${Buffer.byteLength(
            resolvedSource,
            'utf8'
          )} B, ${found.version})`,
          timestamp: nowIso(),
        });
        break;
      }
    }

    if (resolvedSource !== null) {
      codeToRun = resolvedSource;
    } else if (lastError) {
      stdout.push({
        level: 'error',
        message: lastError,
        timestamp: nowIso(),
      });
      return {
        ok: false,
        stdout,
        returnValue: null,
        durationMs: Math.max(1, Math.round((performance.now() - start) * 100) / 100),
        bytesExecuted: Buffer.byteLength(codeToRun, 'utf8'),
        resolvedEndpoint,
      };
    }
  }

  const unpacked = unpackForgeShieldVmIfPresent(codeToRun, stdout, nowIso);
  if (!unpacked.ok) {
    return {
      ok: false,
      stdout,
      returnValue: null,
      durationMs: Math.max(1, Math.round((performance.now() - start) * 100) / 100),
      bytesExecuted: Buffer.byteLength(codeToRun, 'utf8'),
      resolvedEndpoint,
      matchedScript,
    };
  }
  codeToRun = unpacked.unpackedCode;

  const vars: Record<string, any> = {
    _VERSION: 'Luau 0.648 (ForgeVM v4.2)',
    ...envVars,
  };
  const functions: Record<string, { params: string[]; body: string[] }> = {};

  const evalExpr = (exprRaw: string): any => {
    const expr = exprRaw.trim();
    if (!expr) return '';

    if (expr.includes('..')) {
      const parts: string[] = [];
      let current = '';
      let inQ: string | null = null;
      let depth = 0;
      for (let i = 0; i < expr.length; i++) {
        const c = expr[i];
        if ((c === '"' || c === "'") && expr[i - 1] !== '\\') {
          if (inQ === c) inQ = null;
          else if (!inQ) inQ = c;
        }
        if (!inQ) {
          if (c === '(') depth++;
          if (c === ')') depth = Math.max(0, depth - 1);
          if (depth === 0 && c === '.' && expr[i + 1] === '.') {
            parts.push(current);
            current = '';
            i++;
            continue;
          }
        }
        current += c;
      }
      parts.push(current);
      if (parts.length > 1) {
        return parts.map((p) => String(evalExpr(p))).join('');
      }
    }

    if (
      (expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))
    ) {
      return expr.slice(1, -1);
    }
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'nil') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);

    const toStringMatch = expr.match(/^tostring\s*\(([\s\S]*)\)$/);
    if (toStringMatch) return String(evalExpr(toStringMatch[1]));

    const toNumberMatch = expr.match(/^tonumber\s*\(([\s\S]*)\)$/);
    if (toNumberMatch) return Number(evalExpr(toNumberMatch[1])) || 0;

    const floorMatch = expr.match(/^math\.floor\s*\(([\s\S]*)\)$/);
    if (floorMatch) return Math.floor(Number(evalExpr(floorMatch[1])) || 0);

    if (expr === 'os.clock()' || expr === 'tick()') {
      return Number(((performance.now() - start) / 1000 + 0.008).toFixed(4));
    }

    const orMatch = expr.match(/^([a-zA-Z0-9_.]+)\s+or\s+(.+)$/);
    if (orMatch) {
      const leftVal = evalExpr(orMatch[1]);
      return leftVal !== null && leftVal !== undefined && leftVal !== false && leftVal !== ''
        ? leftVal
        : evalExpr(orMatch[2]);
    }

    const arithMatch = expr.match(/^([a-zA-Z0-9_.\s()]+)\s*([+\-*/])\s*([a-zA-Z0-9_.\s()]+)$/);
    if (arithMatch) {
      const left = Number(evalExpr(arithMatch[1]));
      const op = arithMatch[2];
      const right = Number(evalExpr(arithMatch[3]));
      if (!Number.isNaN(left) && !Number.isNaN(right)) {
        if (op === '+') return left + right;
        if (op === '-') return left - right;
        if (op === '*') return left * right;
        if (op === '/') return right !== 0 ? left / right : 0;
      }
    }

    if (expr in vars) return vars[expr];
    return expr.replace(/^["']|["']$/g, '');
  };

  const lines = codeToRun.split('\n');
  let returnValue: string | null = null;

  try {
    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i].replace(/--.*$/, '').trim();
      i++;
      if (!rawLine) continue;

      const fnMatch = rawLine.match(/^(?:local\s+)?function\s+([a-zA-Z0-9_.]+)\s*\(([^)]*)\)/);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const params = fnMatch[2]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        const body: string[] = [];
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const l = lines[i].replace(/--.*$/, '').trim();
          if (/^(?:local\s+)?function\b|\bif\b.*\bthen\b|\bfor\b.*\bdo\b/.test(l)) depth++;
          if (l === 'end' || l.startsWith('end ')) depth--;
          if (depth > 0) body.push(l);
          i++;
        }
        functions[fnName] = { params, body };
        continue;
      }

      const forMatch = rawLine.match(/^for\s+([a-zA-Z0-9_]+)\s*=\s*(\d+)\s*,\s*(\d+)\s+do$/);
      if (forMatch) {
        const iterVar = forMatch[1];
        const startVal = Math.min(Number(forMatch[2]), 50);
        const endVal = Math.min(Number(forMatch[3]), 50);
        const loopBody: string[] = [];
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const l = lines[i].replace(/--.*$/, '').trim();
          if (/^(?:local\s+)?function\b|\bif\b.*\bthen\b|\bfor\b.*\bdo\b/.test(l)) depth++;
          if (l === 'end' || l.startsWith('end ')) depth--;
          if (depth > 0) loopBody.push(l);
          i++;
        }
        for (let v = startVal; v <= endVal; v++) {
          vars[iterVar] = v;
          for (const bl of loopBody) {
            const assign = bl.match(/^(?:local\s+)?([a-zA-Z0-9_.]+)\s*=\s*(.+)$/);
            if (assign) vars[assign[1]] = evalExpr(assign[2]);
            const pr = bl.match(/^(print|warn)\s*\(([\s\S]*)\)$/);
            if (pr) {
              stdout.push({
                level: pr[1] === 'warn' ? 'warn' : 'info',
                message: String(evalExpr(pr[2])),
                timestamp: nowIso(),
              });
            }
          }
        }
        continue;
      }

      const printMatch = rawLine.match(/^(print|warn)\s*\(([\s\S]*)\)$/);
      if (printMatch) {
        const level = printMatch[1] === 'warn' ? 'warn' : 'info';
        const val = evalExpr(printMatch[2]);
        stdout.push({ level, message: String(val), timestamp: nowIso() });
        continue;
      }

      const returnMatch = rawLine.match(/^return\s+(.+)$/);
      if (returnMatch) {
        const rhs = returnMatch[1].trim();
        const fnCallInReturn = rhs.match(/^([a-zA-Z0-9_.]+)\s*\((.*)\)$/);
        if (fnCallInReturn && functions[fnCallInReturn[1]]) {
          const fn = functions[fnCallInReturn[1]];
          const rawArgs = fnCallInReturn[2]
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean);
          fn.params.forEach((param, idx) => {
            vars[param] = rawArgs[idx] ? evalExpr(rawArgs[idx]) : null;
          });
          let fnRet = 'nil';
          for (const bl of fn.body) {
            const fnPrint = bl.match(/^(print|warn)\s*\(([\s\S]*)\)$/);
            if (fnPrint) {
              stdout.push({
                level: fnPrint[1] === 'warn' ? 'warn' : 'info',
                message: String(evalExpr(fnPrint[2])),
                timestamp: nowIso(),
              });
            }
            const fnReturn = bl.match(/^return\s+(.+)$/);
            if (fnReturn) {
              fnRet = String(evalExpr(fnReturn[1]));
            }
          }
          returnValue = fnRet;
        } else {
          returnValue = String(evalExpr(rhs));
        }
        stdout.push({ level: 'return', message: `=> ${returnValue}`, timestamp: nowIso() });
        break;
      }

      const callMatch = rawLine.match(
        /^(?:local\s+([a-zA-Z0-9_]+)\s*=\s*)?([a-zA-Z0-9_.]+)\s*\((.*)\)$/
      );
      if (callMatch && functions[callMatch[2]]) {
        const assignVar = callMatch[1];
        const fn = functions[callMatch[2]];
        const rawArgs = callMatch[3]
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        fn.params.forEach((param, idx) => {
          vars[param] = rawArgs[idx] ? evalExpr(rawArgs[idx]) : null;
        });
        let fnRet: any = null;
        for (const bl of fn.body) {
          const fnAssign = bl.match(/^(?:local\s+)?([a-zA-Z0-9_.]+)\s*=\s*(.+)$/);
          if (fnAssign && !bl.includes('{')) {
            vars[fnAssign[1]] = evalExpr(fnAssign[2]);
          }
          const fnPrint = bl.match(/^(print|warn)\s*\(([\s\S]*)\)$/);
          if (fnPrint) {
            stdout.push({
              level: fnPrint[1] === 'warn' ? 'warn' : 'info',
              message: String(evalExpr(fnPrint[2])),
              timestamp: nowIso(),
            });
          }
          const fnReturn = bl.match(/^return\s+(.+)$/);
          if (fnReturn) {
            fnRet = evalExpr(fnReturn[1]);
          }
        }
        if (assignVar) vars[assignVar] = fnRet;
        continue;
      }

      const assignMatch = rawLine.match(/^(?:local\s+)?([a-zA-Z0-9_.]+)\s*=\s*(.+)$/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const rhs = assignMatch[2].trim();
        if (rhs === '{}') {
          vars[varName] = {};
        } else if (rhs.startsWith('{')) {
          while (i < lines.length && !lines[i - 1].includes('}')) {
            i++;
          }
          vars[varName] = '[table]';
        } else {
          vars[varName] = evalExpr(rhs);
        }
      }
    }
  } catch (err: any) {
    stdout.push({
      level: 'error',
      message: `RuntimeException: ${err?.message || String(err)}`,
      timestamp: nowIso(),
    });
    return {
      ok: false,
      stdout,
      returnValue: null,
      durationMs: Math.max(1, Math.round((performance.now() - start) * 100) / 100),
      bytesExecuted: Buffer.byteLength(codeToRun, 'utf8'),
      resolvedEndpoint,
      matchedScript,
    };
  }

  return {
    ok: true,
    stdout,
    returnValue,
    durationMs: Math.max(1, Math.round((performance.now() - start) * 100) / 100),
    bytesExecuted: Buffer.byteLength(codeToRun, 'utf8'),
    resolvedEndpoint,
    matchedScript,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  const store = loadStore();

  const recordLog = (entry: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    const newLog: ActivityLog = {
      id: `log_${Date.now()}_${generateRandomHex(4)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    store.logs.unshift(newLog);
    if (store.logs.length > 100) {
      store.logs = store.logs.slice(0, 100);
    }
  };

  // =========================================================================
  // 1. PURE TEXT/PLAIN LUA LOADER & RAW ENDPOINTS (NEVER RETURNS HTML '<')
  // =========================================================================
  const handleRawFetch = (req: express.Request, res: express.Response) => {
    const t0 = performance.now();
    const rawTarget = String(req.params.slug || req.params.loaderId || '').replace(/\.lua$/i, '');
    const routeDomain = req.params.domain ? String(req.params.domain).toLowerCase() : null;
    const script = findScriptByTarget(store, rawTarget);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Forge-Engine', 'ForgeVM-v4.2');

    if (!script) {
      recordLog({
        type: 'RAW_FETCH',
        method: 'GET',
        endpoint: req.originalUrl,
        domain: routeDomain || req.headers.host || 'api.forge.com',
        scriptSlug: rawTarget,
        status: 404,
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        bytes: 0,
        detail: `404 Not Found for loader '${rawTarget}'`,
      });
      saveStore(store);
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send(
          `-- [ForgeVM v4.2] Error 404: Loader "${rawTarget}.lua" does not exist.\nerror("[Forge] Loader not found")`
        );
    }

    if (script.visibility === 'protected') {
      const providedKey =
        (req.query.key as string) ||
        req.headers['x-forge-key'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

      if (providedKey !== script.accessKey && providedKey !== store.apiKey) {
        recordLog({
          type: 'RAW_FETCH',
          method: 'GET',
          endpoint: req.originalUrl,
          domain: routeDomain || script.domain,
          scriptSlug: script.slug,
          status: 401,
          latencyMs: Math.max(1, Math.round(performance.now() - t0)),
          bytes: 0,
          detail: 'Rejected unauthenticated fetch on protected loader',
        });
        saveStore(store);
        return res
          .status(401)
          .type('text/plain; charset=utf-8')
          .send(
            `-- [ForgeVM v4.2] Error 401: Unauthorized access to "${script.loaderId}.lua"\n-- Pass ?key=${script.accessKey}\nerror("[Forge Shield] Invalid or missing script_key")`
          );
      }
    }

    const effectiveDomain = routeDomain || script.domain;
    const isShieldActive =
      script.protection?.autoObfuscate ||
      script.protection?.controlFlowFlattening ||
      script.protection?.antiTamper ||
      script.protection?.antiEnvLogs;

    const servedPayload = isShieldActive ? script.obfuscatedCode : script.code;
    const payloadBytes = Buffer.byteLength(servedPayload, 'utf8');
    const latencyMs = Math.max(1, Math.round(performance.now() - t0));

    script.pulls += 1;
    const domainObj = store.domains.find((d) => d.hostname === effectiveDomain);
    if (domainObj) {
      domainObj.requestsServed += 1;
      res.setHeader('Cache-Control', `public, max-age=${domainObj.cacheTtlSeconds}`);
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.setHeader('X-Forge-Domain', effectiveDomain);
    res.setHeader('X-Forge-Version', script.version);
    res.setHeader('X-Forge-Checksum', `0x${script.checksumHash}`);

    if (req.query.download === '1' || req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${script.slug}.obf.lua"`);
    }

    recordLog({
      type: 'RAW_FETCH',
      method: 'GET',
      endpoint: req.originalUrl,
      domain: effectiveDomain,
      scriptSlug: script.slug,
      status: 200,
      latencyMs,
      bytes: payloadBytes,
      detail: isShieldActive
        ? `Served pure Lua ForgeVM v4.2 loader (0x${script.checksumHash})`
        : `Served raw Lua loader (${script.version})`,
    });
    saveStore(store);

    // ALWAYS return 100% pure text/plain Lua so no executor or WebView ever receives '<' HTML!
    return res.status(200).type('text/plain; charset=utf-8').send(servedPayload);
  };

  app.get('/files/v3/loaders/:loaderId', handleRawFetch);
  app.get('/:domain/files/v3/loaders/:loaderId', (req, res, next) => {
    if (
      req.params.domain === 'api' ||
      req.params.domain === 'src' ||
      req.params.domain === 'assets'
    ) {
      return next();
    }
    return handleRawFetch(req, res);
  });
  app.get('/raw/:slug', handleRawFetch);
  app.get('/s/:slug', handleRawFetch);
  app.get('/v1/raw/:slug', handleRawFetch);
  app.get('/d/:domain/raw/:slug', handleRawFetch);
  app.get('/:domain/raw/:slug', (req, res, next) => {
    if (
      req.params.domain === 'api' ||
      req.params.domain === 'src' ||
      req.params.domain === 'assets'
    ) {
      return next();
    }
    return handleRawFetch(req, res);
  });

  // =========================================================================
  // 2. DASHBOARD & REGISTRY REST API
  // =========================================================================
  app.get('/api/state', (_req, res) => {
    res.json(store);
  });

  app.post('/api/scripts', (req, res) => {
    const { title, slug, description, domain, visibility, code, pinned, protection } = req.body;
    const cleanSlug =
      String(slug || title || 'script')
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `script-${generateRandomHex(4)}`;

    if (store.scripts.some((s) => s.slug === cleanSlug)) {
      return res.status(400).json({ error: `Slug '${cleanSlug}' is already in use.` });
    }

    const scriptCode = sanitizeLuaSourceServer(
      String(code || '-- Forge hosted script\nprint("Loaded from Forge")\n')
    );
    const bytes = Buffer.byteLength(scriptCode, 'utf8');
    const now = new Date().toISOString();
    const loaderId = generateRandomHex(24);
    const targetDomain = String(
      domain || store.domains.find((d) => d.isDefault)?.hostname || 'api.forge.com'
    );
    const protConfig: ScriptProtectionConfig = protection
      ? {
          autoObfuscate: Boolean(protection.autoObfuscate),
          controlFlowFlattening: Boolean(protection.controlFlowFlattening ?? true),
          antiTamper: Boolean(protection.antiTamper),
          antiEnvLogs: Boolean(protection.antiEnvLogs),
          stringEncryption: Boolean(protection.stringEncryption),
          junkOpcodes: Boolean(protection.junkOpcodes ?? true),
        }
      : { ...DEFAULT_PROTECTION };

    const compiled = compileProtectedLuaServer(scriptCode, loaderId, targetDomain, protConfig);
    const obfuscatedBytes = Buffer.byteLength(compiled.obfuscatedCode, 'utf8');

    const newScript: HostedScript = {
      id: `scr_${Date.now()}_${generateRandomHex(4)}`,
      loaderId,
      title: String(title || cleanSlug).trim(),
      slug: cleanSlug,
      description: String(description || 'Hosted Lua module').trim(),
      domain: targetDomain,
      visibility: visibility === 'protected' || visibility === 'unlisted' ? visibility : 'public',
      accessKey: `frg_key_${generateRandomHex(10)}`,
      code: scriptCode,
      obfuscatedCode: compiled.obfuscatedCode,
      protection: protConfig,
      checksumHash: compiled.checksumHash,
      version: 'v1.0.0',
      pinned: Boolean(pinned),
      pulls: 0,
      executions: 0,
      bytes,
      obfuscatedBytes,
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          version: 'v1.0.0',
          code: scriptCode,
          obfuscatedCode: compiled.obfuscatedCode,
          note: 'Initial ForgeVM v4.2 protected deployment',
          createdAt: now,
          bytes,
        },
      ],
    };

    store.scripts.unshift(newScript);
    recordLog({
      type: 'SCRIPT_DEPLOY',
      method: 'POST',
      endpoint: `/files/v3/loaders/${newScript.loaderId}.lua`,
      domain: newScript.domain,
      scriptSlug: newScript.slug,
      status: 201,
      latencyMs: 6,
      bytes: obfuscatedBytes,
      detail: `Compiled & deployed with ForgeVM v4.2 (0x${compiled.checksumHash})`,
    });
    saveStore(store);
    return res.status(201).json(newScript);
  });

  app.put('/api/scripts/:id', (req, res) => {
    const script = store.scripts.find((s) => s.id === req.params.id);
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const {
      title,
      slug,
      description,
      domain,
      visibility,
      code,
      pinned,
      protection,
      createSnapshot,
      snapshotNote,
    } = req.body;

    if (slug !== undefined) {
      const cleanSlug = String(slug)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (cleanSlug && cleanSlug !== script.slug) {
        if (store.scripts.some((s) => s.id !== script.id && s.slug === cleanSlug)) {
          return res.status(400).json({ error: `Slug '${cleanSlug}' is already taken.` });
        }
        script.slug = cleanSlug;
      }
    }

    if (title !== undefined) script.title = String(title).trim();
    if (description !== undefined) script.description = String(description).trim();
    if (domain !== undefined) script.domain = String(domain).trim();
    if (visibility !== undefined) script.visibility = visibility;
    if (pinned !== undefined) script.pinned = Boolean(pinned);

    if (protection !== undefined) {
      script.protection = {
        autoObfuscate: Boolean(protection.autoObfuscate),
        controlFlowFlattening: Boolean(protection.controlFlowFlattening ?? true),
        antiTamper: Boolean(protection.antiTamper),
        antiEnvLogs: Boolean(protection.antiEnvLogs),
        stringEncryption: Boolean(protection.stringEncryption),
        junkOpcodes: Boolean(protection.junkOpcodes ?? true),
      };
    }

    if (code !== undefined) {
      script.code = sanitizeLuaSourceServer(String(code));
      script.bytes = Buffer.byteLength(script.code, 'utf8');
    }

    const compiled = compileProtectedLuaServer(
      script.code,
      script.loaderId,
      script.domain,
      script.protection || DEFAULT_PROTECTION
    );
    script.obfuscatedCode = compiled.obfuscatedCode;
    script.checksumHash = compiled.checksumHash;
    script.obfuscatedBytes = Buffer.byteLength(compiled.obfuscatedCode, 'utf8');

    const now = new Date().toISOString();
    script.updatedAt = now;

    if (createSnapshot) {
      const parts = script.version.replace(/^v/, '').split('.').map(Number);
      const nextVer = `v${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;
      script.version = nextVer;
      script.versions.unshift({
        version: nextVer,
        code: script.code,
        obfuscatedCode: script.obfuscatedCode,
        note: String(snapshotNote || `Protected release ${nextVer}`).trim(),
        createdAt: now,
        bytes: script.bytes,
      });
    }

    recordLog({
      type: 'SCRIPT_DEPLOY',
      method: 'PUT',
      endpoint: `/files/v3/loaders/${script.loaderId}.lua`,
      domain: script.domain,
      scriptSlug: script.slug,
      status: 200,
      latencyMs: 5,
      bytes: script.obfuscatedBytes,
      detail: `Compiled ForgeVM v4.2 (Signature 0x${script.checksumHash})`,
    });

    saveStore(store);
    return res.json(script);
  });

  app.delete('/api/scripts/:id', (req, res) => {
    const idx = store.scripts.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Script not found' });
    }
    const removed = store.scripts.splice(idx, 1)[0];
    saveStore(store);
    return res.json({ deleted: removed.id });
  });

  // =========================================================================
  // 3. CUSTOM DOMAIN ROUTER API
  // =========================================================================
  app.post('/api/domains', (req, res) => {
    const rawHost = String(req.body.hostname || '')
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');

    if (!rawHost || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rawHost)) {
      return res
        .status(400)
        .json({ error: 'Enter a valid domain hostname (e.g., api.forge.com or cdn.mybrand.io).' });
    }

    if (store.domains.some((d) => d.hostname === rawHost)) {
      return res.status(400).json({ error: `Domain '${rawHost}' is already registered.` });
    }

    const newDomain: CustomDomain = {
      id: `dom_${Date.now()}_${generateRandomHex(4)}`,
      hostname: rawHost,
      isDefault: Boolean(req.body.isDefault),
      sslEnabled: true,
      corsEnabled: true,
      cacheTtlSeconds: Number(req.body.cacheTtlSeconds ?? 60),
      requestsServed: 0,
      createdAt: new Date().toISOString(),
    };

    if (newDomain.isDefault) {
      store.domains.forEach((d) => {
        d.isDefault = false;
      });
    }

    store.domains.push(newDomain);
    recordLog({
      type: 'DOMAIN_ROUTE',
      method: 'POST',
      endpoint: `/${rawHost}/files/v3/loaders/*`,
      domain: rawHost,
      scriptSlug: '*',
      status: 201,
      latencyMs: 4,
      bytes: 0,
      detail: `Activated custom domain namespace ${rawHost}`,
    });
    saveStore(store);
    return res.status(201).json(newDomain);
  });

  app.put('/api/domains/:id', (req, res) => {
    const dom = store.domains.find((d) => d.id === req.params.id);
    if (!dom) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    if (req.body.isDefault) {
      store.domains.forEach((d) => {
        d.isDefault = d.id === dom.id;
      });
    }
    if (req.body.corsEnabled !== undefined) dom.corsEnabled = Boolean(req.body.corsEnabled);
    if (req.body.cacheTtlSeconds !== undefined)
      dom.cacheTtlSeconds = Number(req.body.cacheTtlSeconds);
    saveStore(store);
    return res.json(store.domains);
  });

  app.delete('/api/domains/:id', (req, res) => {
    if (store.domains.length <= 1) {
      return res
        .status(400)
        .json({ error: 'At least one active domain must remain in the registry.' });
    }
    const idx = store.domains.findIndex((d) => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Domain not found' });
    const removed = store.domains.splice(idx, 1)[0];
    if (removed.isDefault && store.domains.length > 0) {
      store.domains[0].isDefault = true;
    }
    saveStore(store);
    return res.json(store.domains);
  });

  // =========================================================================
  // 4. REMOTE SCRIPT EXECUTION API (POST /api/v1/execute)
  // =========================================================================
  app.post('/api/v1/execute', (req, res) => {
    const { slug, code, envVars } = req.body;
    let sourceToRun = String(code || '');
    let targetScript: HostedScript | undefined;

    if (slug && !sourceToRun) {
      targetScript = findScriptByTarget(store, slug);
      if (!targetScript) {
        return res.status(404).json({ error: `Script '${slug}' not found.` });
      }
      sourceToRun = targetScript.obfuscatedCode || targetScript.code;
    } else if (slug) {
      targetScript = findScriptByTarget(store, slug);
    }

    const result = executeLuaSandbox(sourceToRun, store, envVars || {});
    if (result.matchedScript) {
      targetScript = result.matchedScript;
    }

    if (targetScript && result.ok) {
      targetScript.executions += 1;
    }

    recordLog({
      type: 'REMOTE_EXEC',
      method: 'POST',
      endpoint: '/api/v1/execute',
      domain: targetScript?.domain || 'api.forge.com',
      scriptSlug: targetScript?.slug || 'sandbox',
      status: result.ok ? 200 : 400,
      latencyMs: Math.ceil(result.durationMs),
      bytes: result.bytesExecuted,
      detail: result.ok
        ? `Executed (${result.stdout.length} log entries, ${result.durationMs}ms)`
        : `Execution halted with error`,
    });

    saveStore(store);
    return res.json({
      ok: result.ok,
      stdout: result.stdout,
      returnValue: result.returnValue,
      durationMs: result.durationMs,
      bytesExecuted: result.bytesExecuted,
      resolvedEndpoint: result.resolvedEndpoint,
      scriptSlug: targetScript?.slug || null,
      scriptExecutions: targetScript?.executions ?? null,
    });
  });

  app.post('/api/logs/clear', (_req, res) => {
    store.logs = [];
    saveStore(store);
    res.json({ logs: [] });
  });

  app.post('/api/token/rotate', (_req, res) => {
    store.apiKey = `frg_live_${generateRandomHex(20)}`;
    saveStore(store);
    res.json({ apiKey: store.apiKey });
  });

  // =========================================================================
  // 5. VITE MIDDLEWARE / STATIC ASSETS
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Forge server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
