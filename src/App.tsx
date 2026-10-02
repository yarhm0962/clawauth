import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Copy,
  Check,
  Play,
  Plus,
  Search,
  Terminal,
  Globe,
  Code2,
  Trash2,
  Pin,
  History,
  ArrowUpRight,
  FileCode,
  X,
  ExternalLink,
  Shield,
  Download,
  Cpu,
  Loader2,
} from 'lucide-react';
import {
  HostedScript,
  CustomDomain,
  ActivityLog,
  StoreState,
  ExecutionResult,
  LoadstringMode,
  WorkspaceTab,
  ScriptProtectionConfig,
} from './types';
import {
  getByteSize,
  formatBytes,
  downloadLuaFile,
  minifyLuaClient,
  beautifyLuaClient,
  compileProtectedLua,
  buildLoadstringSnippet,
  buildRawEndpointUrl,
  buildRawEndpointPath,
} from './utils/luaTools';

const SPRING_TRANSITION = {
  type: 'spring' as const,
  stiffness: 460,
  damping: 36,
  mass: 0.65,
};

const DEFAULT_PROTECTION: ScriptProtectionConfig = {
  autoObfuscate: true,
  controlFlowFlattening: true,
  antiTamper: true,
  antiEnvLogs: true,
  stringEncryption: true,
  junkOpcodes: true,
};

export default function App() {
  // Server state
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('frg_live_88f92d41c0b34e719a25');
  const [scripts, setScripts] = useState<HostedScript[]>([]);
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  // Navigation
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');

  // Studio Editor State
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [loaderId, setLoaderId] = useState('9a82f10c4e7b3d128f41a0c9');
  const [title, setTitle] = useState('Nebula UI Library Core');
  const [slug, setSlug] = useState('nebula-ui');
  const [description, setDescription] = useState(
    'Minimalist monochrome windowing & tab component library for Luau client environments.'
  );
  const [selectedDomain, setSelectedDomain] = useState('api.forge.com');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'protected'>('public');
  const [accessKey, setAccessKey] = useState('frg_key_9a82f10c4e');
  const [code, setCode] = useState('');
  const [protection, setProtection] = useState<ScriptProtectionConfig>(DEFAULT_PROTECTION);
  const [editorMode, setEditorMode] = useState<'source' | 'obfuscated'>('source');
  const [loadstringMode, setLoadstringMode] = useState<LoadstringMode>('luarmor');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Floating Obfuscate & Publish Pipeline UI State (0% -> 100%)
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [compileProgress, setCompileProgress] = useState<number>(0);
  const [compileStageText, setCompileStageText] = useState<string>(
    'Initializing ForgeVM v4.2 compiler...'
  );
  const [compileStep, setCompileStep] = useState<number>(0);
  const [publishedScript, setPublishedScript] = useState<HostedScript | null>(null);

  // Quick Inline Custom Domain Creation inside Studio
  const [showInlineDomainInput, setShowInlineDomainInput] = useState(false);
  const [inlineDomainHost, setInlineDomainHost] = useState('');

  // Copy & Toast feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dashboard Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<
    'all' | 'public' | 'protected' | 'unlisted' | 'pinned'
  >('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'pulls' | 'updated' | 'bytes'>('pulls');

  // Modals / Drawers
  const [historyScript, setHistoryScript] = useState<HostedScript | null>(null);
  const [rawPreviewData, setRawPreviewData] = useState<{
    slug: string;
    loaderId: string;
    url: string;
    shortPath: string;
    domain: string;
    status: number;
    latencyMs: number;
    headers: Record<string, string>;
    body: string;
  } | null>(null);
  const [isFetchingRaw, setIsFetchingRaw] = useState(false);

  // Remote Execution API View State
  const [execInputCode, setExecInputCode] = useState('');
  const [execSelectedSlug, setExecSelectedSlug] = useState<string>('nebula-ui');
  const [execResult, setExecResult] = useState<ExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Custom Domains View State
  const [newDomainHostname, setNewDomainHostname] = useState('');
  const [newDomainTtl, setNewDomainTtl] = useState(60);

  // Activity Log Filter
  const [logFilter, setLogFilter] = useState<'ALL' | 'RAW_FETCH' | 'REMOTE_EXEC' | 'SCRIPT_DEPLOY'>(
    'ALL'
  );

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const notify = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  const copyText = useCallback(
    (text: string, id: string, label = 'Copied to clipboard') => {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      notify(label);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1500);
    },
    [notify]
  );

  // Hydrate initial store from backend
  const fetchState = useCallback(
    async (selectFirst = false) => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('Failed to load state');
        const data: StoreState = await res.json();
        setApiKey(data.apiKey);
        setScripts(data.scripts);
        setDomains(data.domains);
        setLogs(data.logs);

        if (selectFirst && data.scripts.length > 0) {
          const first = data.scripts[0];
          setEditingScriptId(first.id);
          setLoaderId(first.loaderId);
          setTitle(first.title);
          setSlug(first.slug);
          setDescription(first.description);
          setSelectedDomain(first.domain);
          setVisibility(first.visibility);
          setAccessKey(first.accessKey);
          setCode(first.code);
          setProtection({
            ...DEFAULT_PROTECTION,
            ...(first.protection || {}),
          });
          const defaultSnippet = buildLoadstringSnippet({
            domain: first.domain,
            slug: first.slug,
            loaderId: first.loaderId,
            visibility: first.visibility,
            accessKey: first.accessKey,
            mode: 'luarmor',
            origin,
            code: first.code,
            protection: first.protection,
          });
          setExecInputCode(defaultSnippet);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [origin]
  );

  useEffect(() => {
    fetchState(true);
  }, [fetchState]);

  // Select a script to edit in Studio
  const loadScriptIntoStudio = (scr: HostedScript) => {
    setEditingScriptId(scr.id);
    setLoaderId(scr.loaderId);
    setTitle(scr.title);
    setSlug(scr.slug);
    setDescription(scr.description);
    setSelectedDomain(scr.domain);
    setVisibility(scr.visibility);
    setAccessKey(scr.accessKey);
    setCode(scr.code);
    setProtection({
      ...DEFAULT_PROTECTION,
      ...(scr.protection || {}),
    });
    setEditorMode('source');
    setSnapshotNote('');
    setActiveTab('studio');
  };

  // Live client-side compiled obfuscated preview
  const liveCompiledPreview = useMemo(() => {
    return compileProtectedLua(code, loaderId, selectedDomain, protection);
  }, [code, loaderId, selectedDomain, protection]);

  // Sync script to backend
  const ensureScriptSynced = async (createSnapshot = false): Promise<HostedScript | null> => {
    const cleanSlug =
      (slug || title || 'script')
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'custom-script';

    setIsSaving(true);
    try {
      if (editingScriptId) {
        const res = await fetch(`/api/scripts/${editingScriptId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: cleanSlug,
            description,
            domain: selectedDomain,
            visibility,
            code,
            protection,
            createSnapshot,
            snapshotNote: snapshotNote || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          notify(data.error || 'Failed to update script');
          return null;
        }
        await fetchState(false);
        setSlug(data.slug);
        setLoaderId(data.loaderId);
        setSnapshotNote('');
        return data as HostedScript;
      } else {
        const res = await fetch('/api/scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: cleanSlug,
            description,
            domain: selectedDomain,
            visibility,
            code,
            protection,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          notify(data.error || 'Failed to deploy script');
          return null;
        }
        await fetchState(false);
        setEditingScriptId(data.id);
        setLoaderId(data.loaderId);
        setSlug(data.slug);
        setAccessKey(data.accessKey);
        return data as HostedScript;
      }
    } catch {
      notify('Network error while syncing script');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  // Smooth Floating Obfuscation & Publish Pipeline (0% -> 100%)
  const handleTriggerObfuscateAndPublish = async (createSnapshot = false) => {
    setPublishModalOpen(true);
    setPublishedScript(null);
    setCompileProgress(0);
    setCompileStep(1);
    setCompileStageText('Parsing Lua AST & stripping comments...');

    const animateProgressTo = async (
      targetPct: number,
      durationMs: number,
      stageLabel: string,
      stepIdx: number
    ) => {
      setCompileStageText(stageLabel);
      setCompileStep(stepIdx);
      const steps = 8;
      const interval = Math.max(15, Math.floor(durationMs / steps));
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, interval));
        setCompileProgress((prev) => {
          const next = Math.round(prev + (targetPct - prev) * (i / steps));
          return Math.min(targetPct, Math.max(prev, next));
        });
      }
      setCompileProgress(targetPct);
    };

    await animateProgressTo(
      20,
      300,
      'Parsing Lua AST & normalizing lexical tokens...',
      1
    );

    await animateProgressTo(
      44,
      360,
      'Adding Anti-Tamper FNV-1a checksum & bytecode lock...',
      2
    );

    await animateProgressTo(
      68,
      360,
      'Injecting Anti-Env Logs, HttpSpy & hookfunction traps...',
      3
    );

    await animateProgressTo(
      88,
      360,
      'Flattening Control-Flow state machine & opaque predicates...',
      4
    );

    setCompileStageText('Obfuscating script into ForgeVM v4.2 bytecode & publishing...');
    setCompileStep(5);
    const saved = await ensureScriptSynced(createSnapshot);

    await animateProgressTo(
      100,
      260,
      'Protection complete (100%) — Obfuscated Lua & Loadstring ready',
      6
    );

    if (saved) {
      setPublishedScript(saved);
    }
  };

  // Start a fresh new script and deploy it immediately so its link works out of the box
  const startNewScriptInStudio = async () => {
    const defaultDom = domains.find((d) => d.isDefault)?.hostname || 'api.forge.com';
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const initialSlug = `module-${randomSuffix}`;
    const initialTitle = `Custom Module ${randomSuffix}`;
    const initialCode = `-- ${initialTitle}
local Module = {}
Module.Domain = "${defaultDom}"
Module.Slug = "${initialSlug}"

function Module.Init()
    print("[ForgeVM] Loaded protected module " .. Module.Slug .. " via " .. Module.Domain)
    return "FORGE_VM_OK"
end

return Module.Init()`;

    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: initialTitle,
          slug: initialSlug,
          description: 'Protected Lua module hosted on ForgeVM v4.2 gateway.',
          domain: defaultDom,
          visibility: 'public',
          code: initialCode,
          protection: DEFAULT_PROTECTION,
        }),
      });
      if (res.ok) {
        const created: HostedScript = await res.json();
        await fetchState(false);
        loadScriptIntoStudio(created);
        notify(`Created protected loader ${created.loaderId.slice(0, 10)}...lua`);
        return;
      }
    } catch {
      // Fallback
    }

    setEditingScriptId(null);
    setTitle(initialTitle);
    setSlug(initialSlug);
    setDescription('Protected Lua module hosted on ForgeVM v4.2 gateway.');
    setSelectedDomain(defaultDom);
    setVisibility('public');
    setCode(initialCode);
    setProtection(DEFAULT_PROTECTION);
    setSnapshotNote('');
    setActiveTab('studio');
  };

  const handleDeleteScript = async (id: string, scriptTitle: string) => {
    try {
      const res = await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const remaining = scripts.filter((s) => s.id !== id);
        await fetchState(false);
        if (editingScriptId === id && remaining.length > 0) {
          loadScriptIntoStudio(remaining[0]);
        }
        notify(`Deleted '${scriptTitle}'`);
      }
    } catch {
      notify('Failed to delete script');
    }
  };

  const handleTogglePin = async (scr: HostedScript) => {
    try {
      const res = await fetch(`/api/scripts/${scr.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !scr.pinned }),
      });
      if (res.ok) {
        await fetchState(false);
        notify(scr.pinned ? `Unpinned '${scr.slug}'` : `Pinned '${scr.slug}'`);
      }
    } catch {
      notify('Failed to update pin status');
    }
  };

  const handleVerifyRawEndpoint = async (
    targetSlug: string,
    targetLoaderId: string,
    targetDomain: string,
    targetKey?: string,
    isProtected?: boolean,
    syncFirst = false
  ) => {
    setIsFetchingRaw(true);
    try {
      let activeSlug = targetSlug;
      let activeLoaderId = targetLoaderId;
      let activeDomain = targetDomain;
      let activeKey = targetKey;
      let activeProt = isProtected;

      if (syncFirst) {
        const synced = await ensureScriptSynced(false);
        if (synced) {
          activeSlug = synced.slug;
          activeLoaderId = synced.loaderId;
          activeDomain = synced.domain;
          activeKey = synced.accessKey;
          activeProt = synced.visibility === 'protected';
        }
      }

      const t0 = performance.now();
      const q = activeProt && activeKey ? `?key=${activeKey}` : '';
      const shortPath = `/files/v3/loaders/${activeLoaderId || activeSlug}.lua${q}`;
      const res = await fetch(shortPath);
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      setRawPreviewData({
        slug: activeSlug,
        loaderId: activeLoaderId,
        url: `${origin}${shortPath}`,
        shortPath,
        domain: activeDomain,
        status: res.status,
        latencyMs,
        headers,
        body,
      });
      await fetchState(false);
    } catch {
      notify('Could not reach raw endpoint');
    } finally {
      setIsFetchingRaw(false);
    }
  };

  // Remote execution runner
  const handleRunRemoteExecution = async (customCode?: string, customSlug?: string) => {
    setIsExecuting(true);
    try {
      const payloadCode = customCode !== undefined ? customCode : execInputCode;
      const res = await fetch('/api/v1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: payloadCode,
          slug: customSlug || execSelectedSlug || undefined,
        }),
      });
      const data: ExecutionResult = await res.json();
      setExecResult(data);
      await fetchState(false);
      notify(data.ok ? `Executed in ${data.durationMs}ms` : 'Execution halted by guard');
    } catch {
      notify('Remote execution request failed');
    } finally {
      setIsExecuting(false);
    }
  };

  // Add custom domain (free)
  const handleCreateDomain = async (hostToCreate: string, isDef = false, ttl = 60) => {
    const clean = hostToCreate
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!clean) {
      notify('Enter a domain hostname first');
      return;
    }
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: clean,
          isDefault: isDef,
          cacheTtlSeconds: ttl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not register domain');
        return;
      }
      await fetchState(false);
      setSelectedDomain(data.hostname);
      setNewDomainHostname('');
      setInlineDomainHost('');
      setShowInlineDomainInput(false);
      notify(`Activated custom domain '${data.hostname}'`);
    } catch {
      notify('Error provisioning domain');
    }
  };

  const handleSetDefaultDomain = async (domId: string) => {
    const res = await fetch(`/api/domains/${domId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) {
      await fetchState(false);
      notify('Updated default loadstring domain');
    }
  };

  const handleDeleteDomain = async (domId: string, hostname: string) => {
    const res = await fetch(`/api/domains/${domId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || 'Cannot delete domain');
      return;
    }
    await fetchState(false);
    notify(`Removed domain ${hostname}`);
  };

  const handleClearLogs = async () => {
    const res = await fetch('/api/logs/clear', { method: 'POST' });
    if (res.ok) {
      setLogs([]);
      notify('Cleared activity log history');
    }
  };

  // Code transformation tools in Studio
  const handleMinifyInStudio = () => {
    const before = getByteSize(code);
    const minified = minifyLuaClient(code);
    const after = getByteSize(minified);
    setCode(minified);
    const savedPct = before > 0 ? Math.max(0, Math.round(((before - after) / before) * 100)) : 0;
    notify(`Minified source: ${formatBytes(before)} → ${formatBytes(after)} (-${savedPct}%)`);
  };

  const handleBeautifyInStudio = () => {
    const formatted = beautifyLuaClient(code);
    setCode(formatted);
    notify('Formatted Lua indentation');
  };

  // Computed Studio values
  const currentRawEndpointUrl = useMemo(() => {
    return buildRawEndpointUrl({
      domain: selectedDomain,
      slug: slug || 'nebula-ui',
      loaderId,
      visibility,
      accessKey,
      mode: loadstringMode,
      origin,
    });
  }, [selectedDomain, slug, loaderId, visibility, accessKey, loadstringMode, origin]);

  const generatedLoadstring = useMemo(() => {
    return buildLoadstringSnippet({
      domain: selectedDomain,
      slug: slug || 'nebula-ui',
      loaderId,
      visibility,
      accessKey,
      mode: loadstringMode,
      origin,
      code,
      protection,
    });
  }, [selectedDomain, slug, loaderId, visibility, accessKey, loadstringMode, origin, code, protection]);

  const displayedEditorContent =
    editorMode === 'obfuscated' ? liveCompiledPreview.obfuscatedCode : code;

  const codeStats = useMemo(() => {
    const lines = displayedEditorContent ? displayedEditorContent.split('\n').length : 1;
    const bytes = getByteSize(displayedEditorContent);
    return { lines, bytes };
  }, [displayedEditorContent]);

  // Filtered & sorted scripts for Dashboard
  const filteredScripts = useMemo(() => {
    return scripts
      .filter((s) => {
        if (visibilityFilter === 'pinned' && !s.pinned) return false;
        if (
          visibilityFilter !== 'all' &&
          visibilityFilter !== 'pinned' &&
          s.visibility !== visibilityFilter
        ) {
          return false;
        }
        if (domainFilter !== 'all' && s.domain !== domainFilter) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          s.loaderId.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sortBy === 'pulls') return b.pulls - a.pulls;
        if (sortBy === 'bytes') return a.bytes - b.bytes;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [scripts, visibilityFilter, domainFilter, searchQuery, sortBy]);

  const aggregateStats = useMemo(() => {
    const totalPulls = scripts.reduce((acc, s) => acc + s.pulls, 0);
    const totalExecs = scripts.reduce((acc, s) => acc + s.executions, 0);
    const totalBytes = scripts.reduce((acc, s) => acc + s.bytes, 0);
    return {
      scriptCount: scripts.length,
      totalPulls,
      totalExecs,
      domainCount: domains.length,
      totalBytes,
    };
  }, [scripts, domains]);

  const lineNumbers = useMemo(() => {
    const count = Math.max(1, displayedEditorContent.split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [displayedEditorContent]);

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F4F4F6] flex flex-col selection:bg-white selection:text-black overflow-x-hidden">
      {/* =====================================================================
          TOP BAR CONTRACT: 3 ZONES (Brand | 5 Nav Links | 2 Actions)
          ===================================================================== */}
      <header className="sticky top-0 z-30 h-14 bg-[#09090B]/95 backdrop-blur-md border-b border-zinc-800/80 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1360px] mx-auto h-full flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#studio"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="text-base font-bold tracking-tight text-white whitespace-nowrap focus-visible:outline-none"
          >
            Forge
          </a>

          {/* Zone 2: 5 clean text navigation links (Desktop) */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-medium">
            {(
              [
                { id: 'studio', label: 'Loadstring Studio' },
                { id: 'scripts', label: 'Hosted Scripts' },
                { id: 'execution', label: 'Execution API' },
                { id: 'domains', label: 'Custom Domains' },
                { id: 'activity', label: 'Activity Logs' },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative h-14 flex items-center transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                    isActive ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <motion.div
                      layoutId="topNavUnderline"
                      transition={SPRING_TRANSITION}
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-white"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 2 Primary Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                handleVerifyRawEndpoint(
                  slug || 'nebula-ui',
                  loaderId,
                  selectedDomain,
                  accessKey,
                  visibility === 'protected',
                  true
                )
              }
              className="h-9 px-3 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 hover:text-white transition-colors duration-150 whitespace-nowrap cursor-pointer"
            >
              Inspect Raw
            </button>
            <button
              onClick={startNewScriptInStudio}
              className="h-9 px-3.5 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors duration-150 whitespace-nowrap cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>New Script</span>
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          MAIN CONTENT CONTAINER (Spacious 1360px centered layout)
          ===================================================================== */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-10">
        <AnimatePresence mode="wait">
          {/* ===============================================================
              TAB 1: LOADSTRING STUDIO & FORGEVM v4.2 OBFUSCATOR
              =============================================================== */}
          {activeTab === 'studio' && (
            <motion.div
              key="studio"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              {/* Studio Top Context & Action Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Loadstring Studio</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-zinc-300 truncate">
                      files/v3/loaders/{loaderId.slice(0, 14)}.lua
                    </span>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                    ForgeVM v4.2 Obfuscator &amp; Loadstring Studio
                  </h1>
                </div>

                {/* Quick Script Switcher + Download + Obfuscate & Publish CTA */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={editingScriptId || ''}
                    onChange={(e) => {
                      const found = scripts.find((s) => s.id === e.target.value);
                      if (found) loadScriptIntoStudio(found);
                    }}
                    aria-label="Switch active script"
                    className="h-10 px-3 text-xs bg-[#0F0F12] border border-zinc-800 rounded-md text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer max-w-[210px] truncate"
                  >
                    {scripts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} ({s.slug})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      downloadLuaFile(
                        `${slug || 'script'}.obf.lua`,
                        liveCompiledPreview.obfuscatedCode
                      );
                      notify(`Downloaded ${slug || 'script'}.obf.lua`);
                    }}
                    className="h-10 px-3.5 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Download .lua</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTriggerObfuscateAndPublish(false)}
                    disabled={isSaving}
                    className="h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5 shrink-0" />
                    <span>{isSaving ? 'Compiling VM...' : 'Obfuscate & Publish'}</span>
                  </button>
                </div>
              </div>

              {/* Studio Main 12-Column Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* LEFT COLUMN (7 cols): Metadata Inputs + Source/Obfuscated Code Editor */}
                <div className="lg:col-span-7 border border-zinc-800/80 bg-[#0F0F12] rounded-lg overflow-hidden min-w-0">
                  {/* Metadata Row */}
                  <div className="p-4 sm:p-5 border-b border-zinc-800/80 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                          Module Title
                        </label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Nebula UI Library"
                          className="w-full h-10 px-3 text-xs bg-[#09090B] border border-zinc-800 rounded-md text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                          Slug Alias
                        </label>
                        <div className="flex items-center h-10 bg-[#09090B] border border-zinc-800 rounded-md focus-within:border-zinc-500">
                          <span className="pl-3 pr-1 text-xs font-mono text-zinc-500 select-none">
                            /raw/
                          </span>
                          <input
                            type="text"
                            value={slug}
                            onChange={(e) =>
                              setSlug(
                                e.target.value
                                  .toLowerCase()
                                  .replace(/[^a-z0-9-_]/g, '-')
                              )
                            }
                            placeholder="nebula-ui"
                            className="w-full pr-3 text-xs font-mono bg-transparent text-white placeholder-zinc-600 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Description
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Brief summary of this script..."
                        className="w-full h-9 px-3 text-xs bg-[#09090B] border border-zinc-800 rounded-md text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>

                  {/* Editor Mode Switcher & Code Actions Bar */}
                  <div className="px-4 sm:px-5 py-2.5 bg-[#09090B] border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
                    {/* Segmented Toggle: Editable Source vs Protected Obfuscated VM Output */}
                    <div className="flex items-center gap-1 p-1 bg-[#0F0F12] border border-zinc-800 rounded-md">
                      <button
                        type="button"
                        onClick={() => setEditorMode('source')}
                        className={`h-7 px-3 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                          editorMode === 'source'
                            ? 'bg-white text-black font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Source Lua
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorMode('obfuscated')}
                        className={`h-7 px-3 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                          editorMode === 'obfuscated'
                            ? 'bg-white text-black font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Obfuscated VM Lua
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-zinc-500 tabular-nums">
                        {codeStats.lines}L · {formatBytes(codeStats.bytes)}
                      </span>
                      {editorMode === 'source' ? (
                        <>
                          <button
                            type="button"
                            onClick={handleMinifyInStudio}
                            className="h-7 px-2.5 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                          >
                            Minify
                          </button>
                          <button
                            type="button"
                            onClick={handleBeautifyInStudio}
                            className="h-7 px-2.5 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                          >
                            Format
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                liveCompiledPreview.obfuscatedCode,
                                'copy_obf_preview',
                                'Copied obfuscated ForgeVM Lua'
                              )
                            }
                            className="h-7 px-2.5 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            Copy VM
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              downloadLuaFile(
                                `${slug || 'script'}.obf.lua`,
                                liveCompiledPreview.obfuscatedCode
                              );
                              notify(`Downloaded ${slug || 'script'}.obf.lua`);
                            }}
                            className="h-7 px-2.5 text-xs font-semibold text-black bg-white rounded hover:bg-zinc-200 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>.lua</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Monospace Code Surface */}
                  <div className="relative flex bg-[#09090B] h-[400px] sm:h-[450px] overflow-y-auto">
                    <div
                      aria-hidden="true"
                      className="py-4 px-3 text-right font-mono text-xs text-zinc-600 select-none border-r border-zinc-800/60 bg-[#09090B] tabular-nums leading-6 shrink-0"
                    >
                      {lineNumbers.map((n) => (
                        <div key={n}>{n}</div>
                      ))}
                    </div>
                    {editorMode === 'source' ? (
                      <textarea
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const start = e.currentTarget.selectionStart;
                            const end = e.currentTarget.selectionEnd;
                            const next = code.substring(0, start) + '    ' + code.substring(end);
                            setCode(next);
                            setTimeout(() => {
                              e.currentTarget.selectionStart = e.currentTarget.selectionEnd =
                                start + 4;
                            }, 0);
                          }
                        }}
                        spellCheck={false}
                        placeholder="-- Paste your Lua source code here..."
                        className="flex-1 p-4 font-mono text-xs leading-6 text-zinc-100 bg-transparent resize-none focus:outline-none overflow-x-auto min-w-0"
                      />
                    ) : (
                      <pre className="flex-1 p-4 font-mono text-xs leading-6 text-zinc-200 overflow-x-auto whitespace-pre select-all min-w-0">
                        {liveCompiledPreview.obfuscatedCode}
                      </pre>
                    )}
                  </div>

                  {/* Bottom Version Snapshot Bar */}
                  <div className="p-4 bg-[#0F0F12] border-t border-zinc-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <input
                      type="text"
                      value={snapshotNote}
                      onChange={(e) => setSnapshotNote(e.target.value)}
                      placeholder="Optional version release note (e.g., Added VM control-flow lock)..."
                      className="flex-1 h-9 px-3 text-xs bg-[#09090B] border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleTriggerObfuscateAndPublish(true)}
                      disabled={isSaving}
                      className="h-9 px-3.5 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Publish New Snapshot
                    </button>
                  </div>
                </div>

                {/* RIGHT COLUMN (5 cols): ForgeVM v4.2 Protection + Loadstring Generator */}
                <div className="lg:col-span-5 space-y-6 min-w-0">
                  {/* PANEL 1: FORGEVM v4.2 VIRTUAL MACHINE & CONTROL-FLOW OBFUSCATOR */}
                  <div className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          01. ForgeVM v4.2 — Virtual Machine &amp; Control Flow
                        </h2>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Multi-pass VM bytecode virtualization, state-machine flow &amp; runtime traps.
                        </p>
                      </div>
                      <span className="font-mono text-xs text-zinc-300 shrink-0">
                        0x{liveCompiledPreview.checksumHash}
                      </span>
                    </div>

                    {/* 6 Protection Layer Toggles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(
                        [
                          {
                            key: 'autoObfuscate',
                            title: 'ForgeVM Bytecode',
                            desc: 'Register file & custom opcode table',
                          },
                          {
                            key: 'controlFlowFlattening',
                            title: 'Control-Flow Flatten',
                            desc: 'Non-linear state machine dispatcher',
                          },
                          {
                            key: 'antiTamper',
                            title: 'Anti-Tamper Lock',
                            desc: 'FNV-1a & rolling bytecode checksum',
                          },
                          {
                            key: 'antiEnvLogs',
                            title: 'Anti-Env Logs',
                            desc: 'Blocks HttpSpy & hooked print/load',
                          },
                          {
                            key: 'stringEncryption',
                            title: 'Rolling Cipher',
                            desc: 'Affine key + per-byte salt stream',
                          },
                          {
                            key: 'junkOpcodes',
                            title: 'Opaque Predicates',
                            desc: 'Dead-branch traps & register scramble',
                          },
                        ] as const
                      ).map((item) => {
                        const isOn = protection[item.key];
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() =>
                              setProtection((prev) => ({
                                ...prev,
                                [item.key]: !prev[item.key],
                              }))
                            }
                            className={`p-3 rounded-md border text-left transition-colors cursor-pointer flex flex-col justify-between gap-1 ${
                              isOn
                                ? 'bg-zinc-900 border-white text-white'
                                : 'bg-[#09090B] border-zinc-800/80 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="text-xs font-semibold">{item.title}</span>
                              <span className="font-mono text-[10px] text-zinc-300">
                                {isOn ? 'ON' : 'OFF'}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 leading-snug">{item.desc}</p>
                          </button>
                        );
                      })}
                    </div>

                    {/* Action Row: Preview Obfuscated Output & Download .lua File */}
                    <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-zinc-400 font-mono tabular-nums">
                        VM Size: {formatBytes(getByteSize(liveCompiledPreview.obfuscatedCode))} ·{' '}
                        {liveCompiledPreview.opcodeCount} Opcodes
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditorMode((m) => (m === 'source' ? 'obfuscated' : 'source'))
                          }
                          className="text-xs font-medium text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
                        >
                          {editorMode === 'obfuscated' ? 'Edit Source' : 'Preview VM Code'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            downloadLuaFile(
                              `${slug || 'script'}.obf.lua`,
                              liveCompiledPreview.obfuscatedCode
                            );
                            notify(`Downloaded ${slug || 'script'}.obf.lua`);
                          }}
                          className="h-8 px-3 text-xs font-semibold text-black bg-white rounded hover:bg-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download .lua</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* PANEL 2: GENERATED LOADSTRING & LUARMOR RAW GATEWAY */}
                  <div className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg p-5 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          02. Live Loadstring &amp; Raw Gateway
                        </h2>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Serves your ForgeVM v4.2 obfuscated script automatically.
                        </p>
                      </div>
                      <span className="text-xs font-mono text-zinc-400 tabular-nums">
                        {getByteSize(generatedLoadstring)} B
                      </span>
                    </div>

                    {/* Format Selector */}
                    <div className="grid grid-cols-4 gap-1 p-1 bg-[#09090B] border border-zinc-800 rounded-md">
                      {(
                        [
                          { id: 'luarmor', label: 'v3 Loader' },
                          { id: 'live', label: 'Short Raw' },
                          { id: 'custom', label: 'Domain' },
                          { id: 'smart', label: 'Safe Pcall' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setLoadstringMode(m.id)}
                          className={`h-8 px-2 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                            loadstringMode === m.id
                              ? 'bg-white text-black font-semibold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Single-Line Scrollable Loadstring Box */}
                    <div className="p-3 bg-[#09090B] border border-zinc-800 rounded-md font-mono text-xs text-zinc-100 overflow-x-auto select-all">
                      <pre className="whitespace-pre leading-relaxed">{generatedLoadstring}</pre>
                    </div>

                    {/* Copy & Open Raw Gateway Buttons */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await ensureScriptSynced(false);
                          copyText(
                            generatedLoadstring,
                            'studio_main_copy',
                            'Copied protected loadstring'
                          );
                        }}
                        className="h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                      >
                        {copiedId === 'studio_main_copy' ? (
                          <>
                            <Check className="w-3.5 h-3.5 shrink-0" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 shrink-0" />
                            <span>Copy Loadstring</span>
                          </>
                        )}
                      </button>

                      <a
                        href={currentRawEndpointUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          ensureScriptSynced(false);
                        }}
                        className="h-10 px-3.5 text-xs font-medium text-zinc-100 bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 hover:text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <span>Open Raw Link</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>

                    {/* Domain & Visibility Controls */}
                    <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-400">Custom Domain</span>
                        <button
                          type="button"
                          onClick={() => setShowInlineDomainInput((v) => !v)}
                          className="text-xs text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
                        >
                          {showInlineDomainInput ? 'Cancel' : '+ Add Free Domain'}
                        </button>
                      </div>

                      {showInlineDomainInput && (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={inlineDomainHost}
                            onChange={(e) => setInlineDomainHost(e.target.value)}
                            placeholder="api.forge.com"
                            className="flex-1 h-9 px-3 text-xs font-mono bg-[#09090B] border border-zinc-800 rounded-md text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleCreateDomain(inlineDomainHost, false, 60)}
                            className="h-9 px-3.5 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 cursor-pointer whitespace-nowrap"
                          >
                            Add
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        {domains.map((dom) => (
                          <button
                            key={dom.id}
                            type="button"
                            onClick={() => setSelectedDomain(dom.hostname)}
                            className={`h-9 px-3 rounded-md border text-xs font-mono truncate text-left transition-colors cursor-pointer ${
                              selectedDomain === dom.hostname
                                ? 'bg-zinc-900 border-white text-white font-semibold'
                                : 'bg-[#09090B] border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {dom.hostname}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-1 p-1 bg-[#09090B] border border-zinc-800 rounded-md">
                        {(
                          [
                            { id: 'public', label: 'Public' },
                            { id: 'unlisted', label: 'Unlisted' },
                            { id: 'protected', label: 'Key Protected' },
                          ] as const
                        ).map((vis) => (
                          <button
                            key={vis.id}
                            type="button"
                            onClick={() => setVisibility(vis.id)}
                            className={`h-8 px-2 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                              visibility === vis.id
                                ? 'bg-white text-black font-semibold'
                                : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            {vis.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ===============================================================
              TAB 2: HOSTED SCRIPTS DASHBOARD
              =============================================================== */}
          {activeTab === 'scripts' && (
            <motion.div
              key="scripts"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Script Registry</p>
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                    Hosted Scripts Dashboard
                  </h1>
                </div>
                <button
                  onClick={startNewScriptInStudio}
                  className="h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create New Script</span>
                </button>
              </div>

              {/* Metric Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 border border-zinc-800/80 bg-[#0F0F12] rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-zinc-800/80">
                <div className="p-4 sm:p-5">
                  <p className="text-xs text-zinc-400">Protected Scripts</p>
                  <p className="text-2xl font-semibold text-white font-mono tabular-nums mt-1">
                    {aggregateStats.scriptCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                    ForgeVM v4.2 active
                  </p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-xs text-zinc-400">Loader Pulls</p>
                  <p className="text-2xl font-semibold text-white font-mono tabular-nums mt-1">
                    {aggregateStats.totalPulls.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">Obfuscated VM deliveries</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-xs text-zinc-400">Remote Executions</p>
                  <p className="text-2xl font-semibold text-white font-mono tabular-nums mt-1">
                    {aggregateStats.totalExecs.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">Anti-Tamper verified runs</p>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-xs text-zinc-400">Custom Domains</p>
                  <p className="text-2xl font-semibold text-white font-mono tabular-nums mt-1">
                    {aggregateStats.domainCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1 font-mono truncate">
                    Default: {domains.find((d) => d.isDefault)?.hostname || 'api.forge.com'}
                  </p>
                </div>
              </div>

              {/* Search & Filter Controls */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search scripts by title, slug, loader ID, or domain..."
                    className="w-full h-10 pl-9 pr-3 text-xs bg-[#0F0F12] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-[#0F0F12] border border-zinc-800 rounded-md">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'pinned', label: 'Pinned' },
                        { id: 'public', label: 'Public' },
                        { id: 'protected', label: 'Protected' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setVisibilityFilter(f.id)}
                        className={`h-8 px-3 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                          visibilityFilter === f.id
                            ? 'bg-white text-black font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    aria-label="Filter by domain"
                    className="h-10 px-3 text-xs bg-[#0F0F12] border border-zinc-800 rounded-md text-zinc-300 focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Domains</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.hostname}>
                        {d.hostname}
                      </option>
                    ))}
                  </select>

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    aria-label="Sort scripts"
                    className="h-10 px-3 text-xs bg-[#0F0F12] border border-zinc-800 rounded-md text-zinc-300 focus:outline-none cursor-pointer"
                  >
                    <option value="pulls">Most Pulls</option>
                    <option value="updated">Recently Updated</option>
                    <option value="bytes">Smallest Size</option>
                  </select>
                </div>
              </div>

              {/* Responsive Script Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredScripts.map((scr) => {
                  const snippet = buildLoadstringSnippet({
                    domain: scr.domain,
                    slug: scr.slug,
                    loaderId: scr.loaderId,
                    visibility: scr.visibility,
                    accessKey: scr.accessKey,
                    mode: 'luarmor',
                    origin,
                    code: scr.code,
                    protection: scr.protection,
                  });
                  const rawUrl = buildRawEndpointUrl({
                    domain: scr.domain,
                    slug: scr.slug,
                    loaderId: scr.loaderId,
                    visibility: scr.visibility,
                    accessKey: scr.accessKey,
                    mode: 'luarmor',
                    origin,
                  });
                  const shieldOn =
                    scr.protection?.autoObfuscate ||
                    scr.protection?.controlFlowFlattening ||
                    scr.protection?.antiTamper ||
                    scr.protection?.antiEnvLogs;

                  return (
                    <div
                      key={scr.id}
                      className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg p-5 flex flex-col justify-between gap-4 min-w-0"
                    >
                      <div className="space-y-3 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              onClick={() => loadScriptIntoStudio(scr)}
                              className="text-base font-semibold text-white hover:underline text-left truncate block cursor-pointer"
                            >
                              {scr.title}
                            </button>
                            <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">
                              {scr.description}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => {
                                downloadLuaFile(
                                  `${scr.slug}.obf.lua`,
                                  scr.obfuscatedCode || scr.code
                                );
                                notify(`Downloaded ${scr.slug}.obf.lua`);
                              }}
                              title="Download obfuscated .lua file"
                              className="h-8 w-8 flex items-center justify-center rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setHistoryScript(scr)}
                              title="Version history"
                              className="h-8 w-8 flex items-center justify-center rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleTogglePin(scr)}
                              title="Pin script"
                              className={`h-8 w-8 flex items-center justify-center rounded border border-zinc-800 cursor-pointer ${
                                scr.pinned
                                  ? 'bg-zinc-800 text-white'
                                  : 'bg-zinc-900 text-zinc-500 hover:text-white'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteScript(scr.id, scr.title)}
                              title="Delete script"
                              className="h-8 w-8 flex items-center justify-center rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Unboxed Metadata Line */}
                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-zinc-400">
                          <span className="text-zinc-200">{scr.version}</span>
                          <span aria-hidden="true">·</span>
                          <span>{scr.domain}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {shieldOn ? `ForgeVM 0x${scr.checksumHash}` : 'Unprotected'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{scr.pulls.toLocaleString()} pulls</span>
                        </div>

                        {/* Clean Single-Line Loader Path */}
                        <div className="px-3 py-2 bg-[#09090B] border border-zinc-800 rounded font-mono text-xs text-zinc-300 truncate select-all">
                          /files/v3/loaders/{scr.loaderId}.lua
                        </div>
                      </div>

                      {/* Card Action Row */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <button
                          onClick={() =>
                            copyText(
                              snippet,
                              `card_copy_${scr.id}`,
                              `Copied ${scr.slug} loadstring`
                            )
                          }
                          className="h-9 px-3 text-xs font-semibold text-black bg-white rounded hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          {copiedId === `card_copy_${scr.id}` ? (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 shrink-0" />
                              <span>Copy Loader</span>
                            </>
                          )}
                        </button>

                        <a
                          href={rawUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="h-9 px-3 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <span>Open Raw</span>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        </a>

                        <button
                          onClick={() => loadScriptIntoStudio(scr)}
                          className="h-9 px-3 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-white transition-colors flex items-center justify-center cursor-pointer whitespace-nowrap"
                        >
                          Edit &amp; Shield
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ===============================================================
              TAB 3: REMOTE SCRIPT EXECUTION API & SANDBOX
              =============================================================== */}
          {activeTab === 'execution' && (
            <motion.div
              key="execution"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Remote Sandbox &amp; ForgeVM Verifier</p>
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                    Remote Execution Engine &amp; REST API
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={execSelectedSlug}
                    onChange={(e) => {
                      const s = scripts.find((item) => item.slug === e.target.value);
                      setExecSelectedSlug(e.target.value);
                      if (s) {
                        const ls = buildLoadstringSnippet({
                          domain: s.domain,
                          slug: s.slug,
                          loaderId: s.loaderId,
                          visibility: s.visibility,
                          accessKey: s.accessKey,
                          mode: 'luarmor',
                          origin,
                          code: s.code,
                          protection: s.protection,
                        });
                        setExecInputCode(ls);
                      }
                    }}
                    className="h-10 px-3 text-xs font-mono bg-[#0F0F12] border border-zinc-800 rounded-md text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    {scripts.map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.title} ({s.slug})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleRunRemoteExecution()}
                    disabled={isExecuting}
                    className="h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 shrink-0" />
                    <span>{isExecuting ? 'Executing...' : 'Execute Remotely'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Input Payload */}
                <div className="lg:col-span-6 border border-zinc-800/80 bg-[#0F0F12] rounded-lg overflow-hidden flex flex-col">
                  <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">Execution Input</h2>
                      <p className="text-xs text-zinc-400">
                        Test a <code className="font-mono text-zinc-200">loadstring(...)()</code> or paste ForgeVM v4.2 Lua.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const s =
                          scripts.find((item) => item.slug === execSelectedSlug) || scripts[0];
                        if (s) {
                          setExecInputCode(s.obfuscatedCode || s.code);
                          notify(`Loaded ForgeVM v4.2 code for ${s.slug}`);
                        }
                      }}
                      className="text-xs text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer whitespace-nowrap"
                    >
                      Load Obfuscated VM
                    </button>
                  </div>

                  <textarea
                    value={execInputCode}
                    onChange={(e) => setExecInputCode(e.target.value)}
                    spellCheck={false}
                    rows={10}
                    className="flex-1 p-4 font-mono text-xs leading-6 bg-[#09090B] text-zinc-100 focus:outline-none resize-none"
                  />

                  <div className="px-5 py-3 border-t border-zinc-800/80 bg-[#0F0F12] flex items-center justify-between text-xs text-zinc-400">
                    <span>Verifies Control-Flow state machine, Anti-Tamper &amp; Anti-Env guards</span>
                    <span className="font-mono">POST /api/v1/execute</span>
                  </div>
                </div>

                {/* Output Stream */}
                <div className="lg:col-span-6 border border-zinc-800/80 bg-[#0F0F12] rounded-lg overflow-hidden flex flex-col">
                  <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">Sandbox Output Stream</h2>
                      <p className="text-xs text-zinc-400">
                        Real-time ForgeVM v4.2 verification &amp; Lua stdout logs.
                      </p>
                    </div>
                    {execResult && (
                      <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                        <span
                          className={
                            execResult.ok
                              ? 'text-white font-semibold'
                              : 'text-red-400 font-semibold'
                          }
                        >
                          {execResult.ok ? '200 OK' : '400 HALTED'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-400">{execResult.durationMs}ms</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 p-4 bg-[#09090B] font-mono text-xs space-y-2 min-h-[240px] max-h-[340px] overflow-y-auto">
                    {!execResult ? (
                      <div className="h-full flex flex-col items-center justify-center text-center py-12 text-zinc-500">
                        <p>Click &quot;Execute Remotely&quot; to test your loader or obfuscated VM script.</p>
                      </div>
                    ) : (
                      <>
                        <div className="text-[11px] text-zinc-500 pb-2 border-b border-zinc-800/60 truncate">
                          Target: {execResult.resolvedEndpoint}
                        </div>
                        {execResult.stdout.map((line, idx) => (
                          <div key={idx} className="flex items-start gap-2.5 leading-relaxed">
                            <span className="text-zinc-600 shrink-0 select-none tabular-nums">
                              {line.timestamp}
                            </span>
                            <span
                              className={`break-words ${
                                line.level === 'error'
                                  ? 'text-red-400 font-semibold'
                                  : line.level === 'warn'
                                  ? 'text-amber-300'
                                  : line.level === 'return'
                                  ? 'text-white font-semibold'
                                  : 'text-zinc-200'
                              }`}
                            >
                              {line.message}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ===============================================================
              TAB 4: CUSTOM DOMAINS ROUTER
              =============================================================== */}
          {activeTab === 'domains' && (
            <motion.div
              key="domains"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              <div className="pb-5 border-b border-zinc-800/80">
                <p className="text-xs text-zinc-400 mb-1">Domain Routing</p>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                  Custom Domain Registry
                </h1>
              </div>

              <div className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Add Free Custom Loadstring Domain
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Attach any custom domain hostname (e.g. <code className="font-mono text-zinc-200">api.forge.com</code>) for your loader routes.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-6">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Domain Hostname
                    </label>
                    <input
                      type="text"
                      value={newDomainHostname}
                      onChange={(e) => setNewDomainHostname(e.target.value)}
                      placeholder="api.nexus.com"
                      className="w-full h-10 px-3 text-xs font-mono bg-[#09090B] border border-zinc-800 rounded-md text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Cache TTL
                    </label>
                    <select
                      value={newDomainTtl}
                      onChange={(e) => setNewDomainTtl(Number(e.target.value))}
                      className="w-full h-10 px-3 text-xs bg-[#09090B] border border-zinc-800 rounded-md text-zinc-200 focus:outline-none cursor-pointer"
                    >
                      <option value={0}>0s (Instant)</option>
                      <option value={60}>60s (Standard)</option>
                      <option value={300}>300s (High Traffic)</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <button
                      type="button"
                      onClick={() => handleCreateDomain(newDomainHostname, false, newDomainTtl)}
                      className="w-full h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      Activate Domain
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {domains.map((dom) => (
                  <div
                    key={dom.id}
                    className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-white">
                        {dom.hostname}
                      </span>
                      <span className="text-xs font-mono text-zinc-400 tabular-nums">
                        {dom.requestsServed.toLocaleString()} requests
                      </span>
                    </div>
                    <div className="text-xs font-mono text-zinc-400 truncate">
                      /{dom.hostname}/files/v3/loaders/:id.lua
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => {
                          setSelectedDomain(dom.hostname);
                          setActiveTab('studio');
                          notify(`Selected ${dom.hostname} in Studio`);
                        }}
                        className="h-9 px-3.5 text-xs font-semibold text-black bg-white rounded hover:bg-zinc-200 cursor-pointer"
                      >
                        Use in Studio
                      </button>
                      {!dom.isDefault && (
                        <button
                          onClick={() => handleSetDefaultDomain(dom.id)}
                          className="h-9 px-3 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 rounded hover:text-white cursor-pointer"
                        >
                          Set Default
                        </button>
                      )}
                      {domains.length > 1 && (
                        <button
                          onClick={() => handleDeleteDomain(dom.id, dom.hostname)}
                          className="h-9 px-2.5 text-zinc-500 bg-zinc-900 border border-zinc-800 rounded hover:text-red-400 cursor-pointer ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ===============================================================
              TAB 5: ACTIVITY LOGS
              =============================================================== */}
          {activeTab === 'activity' && (
            <motion.div
              key="activity"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Telemetry</p>
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                    Gateway &amp; Execution Logs
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-[#0F0F12] border border-zinc-800 rounded-md">
                    {(
                      [
                        { id: 'ALL', label: 'All' },
                        { id: 'RAW_FETCH', label: 'Pulls' },
                        { id: 'REMOTE_EXEC', label: 'Executions' },
                        { id: 'SCRIPT_DEPLOY', label: 'Deploys' },
                      ] as const
                    ).map((lf) => (
                      <button
                        key={lf.id}
                        onClick={() => setLogFilter(lf.id)}
                        className={`h-8 px-2.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                          logFilter === lf.id
                            ? 'bg-white text-black font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {lf.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleClearLogs}
                    className="h-9 px-3 text-xs font-medium text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-md hover:text-white cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="border border-zinc-800/80 bg-[#0F0F12] rounded-lg divide-y divide-zinc-800/60">
                {logs
                  .filter((l) => logFilter === 'ALL' || l.type === logFilter)
                  .map((log) => (
                    <div
                      key={log.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              log.status >= 400
                                ? 'text-red-400 font-semibold'
                                : 'text-white font-semibold'
                            }
                          >
                            {log.status}
                          </span>
                          <span className="text-zinc-400">{log.method}</span>
                          <span className="text-zinc-200 truncate">{log.endpoint}</span>
                        </div>
                        <p className="text-zinc-400 font-sans">{log.detail}</p>
                      </div>
                      <div className="text-zinc-500 tabular-nums shrink-0">
                        {log.domain} · {log.latencyMs}ms ·{' '}
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* =====================================================================
          MOBILE FIXED BOTTOM NAVIGATION BAR
          ===================================================================== */}
      <nav
        aria-label="Mobile workspace navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#09090B]/95 backdrop-blur-md border-t border-zinc-800/90 grid grid-cols-5 items-center px-1 select-none"
      >
        {(
          [
            { id: 'studio', label: 'Studio', icon: Code2 },
            { id: 'scripts', label: 'Scripts', icon: FileCode },
            { id: 'execution', label: 'Execute', icon: Terminal },
            { id: 'domains', label: 'Domains', icon: Globe },
            { id: 'activity', label: 'Logs', icon: History },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative min-h-[48px] flex flex-col items-center justify-center rounded-md transition-colors cursor-pointer ${
                isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {isActive && (
                <span className="w-5 h-[2px] bg-white rounded-full absolute top-0.5" />
              )}
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* =====================================================================
          FLOATING UI: FORGEVM v4.2 OBFUSCATOR & LOADING PIPELINE (0% -> 100%)
          ===================================================================== */}
      <AnimatePresence>
        {publishModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
            onClick={() => {
              if (compileProgress >= 100) setPublishModalOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={SPRING_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl border border-zinc-800 bg-[#0F0F12] rounded-xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
            >
              {/* Floating Header */}
              <div className="px-5 py-4 border-b border-zinc-800/90 flex items-center justify-between gap-3 bg-[#09090B]">
                <div className="flex items-center gap-2.5 min-w-0">
                  {compileProgress < 100 ? (
                    <Loader2 className="w-4 h-4 text-white animate-spin shrink-0" />
                  ) : (
                    <Shield className="w-4 h-4 text-white shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">
                      ForgeVM v4.2 — Virtual Machine &amp; Control-Flow Obfuscator
                    </h3>
                    <p className="text-xs text-zinc-400 truncate">
                      {compileStageText}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-base font-bold text-white tabular-nums">
                    {compileProgress}%
                  </span>
                  {compileProgress >= 100 && (
                    <button
                      onClick={() => setPublishModalOpen(false)}
                      className="h-8 w-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Smooth 0% -> 100% Progress Bar */}
              <div className="w-full h-1.5 bg-zinc-900 overflow-hidden">
                <motion.div
                  className="h-full bg-white"
                  initial={{ width: '0%' }}
                  animate={{ width: `${compileProgress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.15 }}
                />
              </div>

              <div className="p-5 space-y-5 overflow-y-auto">
                {/* Live Stage Pipeline Breakdown */}
                <div className="space-y-2 bg-[#09090B] border border-zinc-800 rounded-lg p-4 font-mono text-xs">
                  {[
                    {
                      step: 1,
                      label: '01. Parsing Lua AST & stripping lexical comments',
                      enabled: true,
                    },
                    {
                      step: 2,
                      label: `02. Adding Anti-Tamper FNV-1a checksum lock (0x${liveCompiledPreview.checksumHash})`,
                      enabled: protection.antiTamper,
                    },
                    {
                      step: 3,
                      label: '03. Injecting Anti-Env Logs, HttpSpy & hookfunction traps',
                      enabled: protection.antiEnvLogs,
                    },
                    {
                      step: 4,
                      label: '04. Flattening Control-Flow state machine & opaque predicates',
                      enabled: protection.controlFlowFlattening,
                    },
                    {
                      step: 5,
                      label: '05. Obfuscating script into ForgeVM v4.2 bytecode & syncing loader',
                      enabled: protection.autoObfuscate,
                    },
                  ].map((s) => {
                    const done = compileStep > s.step || compileProgress >= 100;
                    const active = compileStep === s.step && compileProgress < 100;
                    return (
                      <div
                        key={s.step}
                        className={`flex items-center justify-between gap-2 py-1 ${
                          done
                            ? 'text-zinc-200'
                            : active
                            ? 'text-white font-semibold'
                            : 'text-zinc-600'
                        }`}
                      >
                        <span className="truncate">{s.label}</span>
                        <span className="shrink-0">
                          {!s.enabled
                            ? 'BYPASSED'
                            : done
                            ? 'COMPLETE'
                            : active
                            ? 'WORKING...'
                            : 'WAITING'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Revealed at 100%: Loadstring + Obfuscated Lua + File Download */}
                {compileProgress >= 100 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    {/* Block 1: Generated Loadstring */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white">
                          1. Protected Loadstring (Ready to Execute)
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              copyText(
                                generatedLoadstring,
                                'modal_copy_ls',
                                'Copied protected loadstring'
                              )
                            }
                            className="text-zinc-200 hover:text-white underline underline-offset-4 cursor-pointer font-medium"
                          >
                            {copiedId === 'modal_copy_ls' ? 'Copied!' : 'Copy Loadstring'}
                          </button>
                          <a
                            href={currentRawEndpointUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-zinc-300 hover:text-white underline underline-offset-4 flex items-center gap-1"
                          >
                            <span>Open Raw Link</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                      <div className="p-3 bg-[#09090B] border border-zinc-800 rounded-md font-mono text-xs text-white overflow-x-auto select-all">
                        <pre className="whitespace-pre">{generatedLoadstring}</pre>
                      </div>
                    </div>

                    {/* Block 2: Obfuscated Lua VM Output */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white">
                          2. Obfuscated Lua Output (ForgeVM v4.2 + Control Flow)
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-zinc-400">
                            {formatBytes(
                              getByteSize(
                                publishedScript?.obfuscatedCode ||
                                  liveCompiledPreview.obfuscatedCode
                              )
                            )}
                          </span>
                          <button
                            onClick={() =>
                              copyText(
                                publishedScript?.obfuscatedCode ||
                                  liveCompiledPreview.obfuscatedCode,
                                'modal_copy_vm',
                                'Copied obfuscated Lua VM script'
                              )
                            }
                            className="text-zinc-200 hover:text-white underline underline-offset-4 cursor-pointer font-medium"
                          >
                            {copiedId === 'modal_copy_vm' ? 'Copied!' : 'Copy Obfuscated Lua'}
                          </button>
                        </div>
                      </div>
                      <pre className="p-3.5 bg-[#09090B] border border-zinc-800 rounded-md font-mono text-[11px] leading-5 text-zinc-300 max-h-48 overflow-y-auto whitespace-pre select-all">
                        {publishedScript?.obfuscatedCode || liveCompiledPreview.obfuscatedCode}
                      </pre>
                    </div>

                    {/* Action Buttons Row: Download .lua File + Copy Loadstring + Copy Obfuscated + Test */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                      <button
                        onClick={() =>
                          copyText(
                            generatedLoadstring,
                            'modal_btn_ls',
                            'Copied protected loadstring'
                          )
                        }
                        className="h-10 px-4 text-xs font-semibold text-black bg-white rounded-md hover:bg-zinc-200 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Loadstring</span>
                      </button>

                      <button
                        onClick={() => {
                          const obf =
                            publishedScript?.obfuscatedCode ||
                            liveCompiledPreview.obfuscatedCode;
                          downloadLuaFile(`${slug || 'script'}.obf.lua`, obf);
                          notify(`Downloaded ${slug || 'script'}.obf.lua`);
                        }}
                        className="h-10 px-4 text-xs font-semibold text-white bg-zinc-900 border border-zinc-700 rounded-md hover:bg-zinc-800 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download .lua File</span>
                      </button>

                      <button
                        onClick={() => {
                          setPublishModalOpen(false);
                          setEditorMode('obfuscated');
                        }}
                        className="h-10 px-4 text-xs font-medium text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md hover:bg-zinc-800 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>View in Editor</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          MODAL 2: LIVE RAW HTTP ENDPOINT INSPECTOR
          ===================================================================== */}
      <AnimatePresence>
        {rawPreviewData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setRawPreviewData(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={SPRING_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl border-t sm:border border-zinc-800 bg-[#0F0F12] rounded-t-2xl sm:rounded-lg overflow-hidden shadow-2xl max-h-[85vh] flex flex-col"
            >
              <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">
                    Protected Raw Loader Verification
                  </h3>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">
                    GET {rawPreviewData.shortPath}
                  </p>
                </div>
                <button
                  onClick={() => setRawPreviewData(null)}
                  className="h-8 w-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-[#09090B] border border-zinc-800 rounded-md px-3.5 py-2.5">
                  <div>
                    Status:{' '}
                    <span className="text-white font-semibold">
                      HTTP {rawPreviewData.status} OK
                    </span>
                  </div>
                  <div>Latency: {rawPreviewData.latencyMs}ms</div>
                  <div>Checksum: {rawPreviewData.headers['x-forge-checksum'] || 'Verified'}</div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                    <span>Served Payload (ForgeVM v4.2 Protected Code)</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          downloadLuaFile(`${rawPreviewData.slug}.obf.lua`, rawPreviewData.body);
                          notify(`Downloaded ${rawPreviewData.slug}.obf.lua`);
                        }}
                        className="text-white hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download .lua</span>
                      </button>
                      <a
                        href={rawPreviewData.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white hover:underline flex items-center gap-1"
                      >
                        <span>Open Gateway Page</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                  <pre className="p-3.5 bg-[#09090B] border border-zinc-800 rounded-md font-mono text-xs text-zinc-200 max-h-60 overflow-y-auto whitespace-pre">
                    {rawPreviewData.body}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          MODAL 3: SCRIPT VERSION SNAPSHOT HISTORY & RESTORE
          ===================================================================== */}
      <AnimatePresence>
        {historyScript && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setHistoryScript(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={SPRING_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl border-t sm:border border-zinc-800 bg-[#0F0F12] rounded-t-2xl sm:rounded-lg overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Version History — {historyScript.title}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Restore any previous release snapshot into the Studio.
                  </p>
                </div>
                <button
                  onClick={() => setHistoryScript(null)}
                  className="h-8 w-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto divide-y divide-zinc-800/80">
                {historyScript.versions.map((ver, idx) => (
                  <div key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-white font-semibold">{ver.version}</span>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="text-zinc-400">{formatBytes(ver.bytes)}</span>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="text-zinc-500">
                          {new Date(ver.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          loadScriptIntoStudio({
                            ...historyScript,
                            code: ver.code,
                          });
                          setHistoryScript(null);
                          notify(`Restored ${ver.version} into Studio buffer`);
                        }}
                        className="h-8 px-3 text-xs font-semibold text-black bg-white rounded hover:bg-zinc-200 transition-colors cursor-pointer"
                      >
                        Load Snapshot
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400">{ver.note}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          LIGHTWEIGHT MONOCHROME TOAST NOTIFICATION
          ===================================================================== */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.14 }}
            className="fixed bottom-20 md:bottom-5 right-4 sm:right-5 z-50 px-4 py-2.5 bg-white text-black text-xs font-semibold rounded-md shadow-lg flex items-center gap-2 pointer-events-none"
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
