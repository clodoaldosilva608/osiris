'use client';
/**
 * OSIRIS OAI — the panel.
 *
 * Docked, it is a column beside the map: set up an engine with your own key,
 * ask, then follow the run, read the report and question the panel.
 * Full screen, it becomes a theatre around the globe: the verdict and report
 * on the left, the debate, the panel and the world model on the right, and the
 * globe left live in the middle, where every arc and point can be clicked.
 * Whatever is selected (from the globe or from a list) opens in the inspector,
 * which shows exactly that piece of the research.
 *
 * The run itself lives in the page (useOai), so closing this panel leaves the
 * globe drawing.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownRight, ArrowUpRight, Camera, Check, ChevronDown, ChevronUp, Copy, Crosshair, Download, Eye, EyeOff, History,
  KeyRound, Loader2, LocateFixed, Maximize2, MessageSquare, Minimize2, Orbit, Plus, Send, Square, Trash2, X, Zap,
} from 'lucide-react';
import { PROVIDERS, providerInfo, type ProviderId } from '@/lib/oai/providers';
import { DEPTHS, estimateCalls } from '@/lib/oai/depths';
import { checkKey, forgetKey, loadEngine, loadKey, saveEngine, saveKey, toMarkdown, type Engine, type OaiClient } from '@/lib/oai/client';
import { currentAnswer, latestPosts, type RunState } from '@/lib/oai/state';
import { agentTint, estimateRange, leanColor } from '@/lib/oai/globe';
import { directionWord, formatAmount, leader, outcomeColor, postView } from '@/lib/oai/forecast';
import { nodeName, postFor, relatedLinks, resolve, type Selection } from '@/lib/oai/research';
import type { ContextItem, Depth, Frame, Link, Post, RoundStat } from '@/lib/oai/types';

/* ───────────────────────────── Tokens ───────────────────────────── */

const ACCENT = 'var(--gold-primary)';
/** The theatre's surfaces: solid enough that the app's own HUD never shows through. */
const SOLID = { background: 'color-mix(in srgb, var(--bg-primary) 94%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' };
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const pct = (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`);
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const EXAMPLES = [
  'Will Brent crude settle above $90 a barrel on 31 December 2026?',
  'Which way will the US Federal Reserve move rates at its next meeting: cut, hold or hike?',
  'What will the US 10-year Treasury yield be on 31 March 2027?',
  'Will Russia and Ukraine agree a ceasefire before 1 July 2027?',
];

const PHASES: { id: RunState['phase']; label: string }[] = [
  { id: 'context', label: 'Feeds' },
  { id: 'graph', label: 'World' },
  { id: 'agents', label: 'Panel' },
  { id: 'simulate', label: 'Debate' },
  { id: 'report', label: 'Report' },
];

const KIND_LABEL: Record<Frame['kind'], string> = { binary: 'Yes / No', choice: 'Outcomes', number: 'Estimate' };

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/* ───────────────────────────── The panel ───────────────────────────── */

export interface OaiPanelProps {
  oai: OaiClient;
  /** What is selected: a node key, or "link:<id>" for an arc. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  onClose?: () => void;
  /** Inside another container (the phone drawer): no frame of its own, no full screen. */
  embedded?: boolean;
  /** Whether the other map layers are hidden so the analysis stands out, and the switch for it. */
  focus?: boolean;
  onFocus?: () => void;
  /** Full screen around the globe. */
  theater?: boolean;
  onTheater?: (on: boolean) => void;
  /** Whether the camera is following the run, and the way to ask it to. */
  following?: boolean;
  onFollow?: () => void;
}

/** The engine this browser last used, or OpenAI with its default model. */
function initialEngine(): Engine {
  const saved = loadEngine();
  if (saved && PROVIDERS.some(p => p.id === saved.provider)) return saved;
  return { provider: 'openai', model: providerInfo('openai').defaultModel, remember: false };
}

type Tab = 'report' | 'debate' | 'panel' | 'world' | 'ask';

export default function OaiPanel(props: OaiPanelProps) {
  const { oai, selected, onSelect, embedded = false, theater = false } = props;
  // Settings come from this browser's storage. The panel only renders once opened, on the client.
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [key, setKey] = useState(() => loadKey(initialEngine().provider));
  const [engineOpen, setEngineOpen] = useState(() => {
    const e = initialEngine();
    return providerInfo(e.provider).needsKey && !loadKey(e.provider);
  });
  /** Over a run the engine card starts folded: a visitor following a shared link has come to read. */
  const [engineOpenInRun, setEngineOpenInRun] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [askTarget, setAskTarget] = useState('report');

  const s = oai.state;
  const info = providerInfo(engine.provider);
  const ready = !info.needsKey || key.length > 0;
  const selection = s ? resolve(s, selected) : null;
  // Until someone picks a tab: the debate while it runs, the report once there is one.
  const activeTab: Tab = tab ?? (s?.report ? 'report' : 'debate');

  useEffect(() => {
    if (!theater) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onTheater?.(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [theater, props]);

  const askAgent = (id: string) => { setAskTarget(id); setTab('ask'); };

  const engineCard = (
    <EngineCard
      engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey}
      open={s ? engineOpenInRun : engineOpen} setOpen={s ? setEngineOpenInRun : setEngineOpen}
    />
  );
  const errorBox = oai.error ? (
    <div className="rounded-md border px-3 py-2 text-[11px] text-[var(--text-primary)] flex items-start gap-2" style={{ borderColor: tint('var(--alert-red)', 45), background: tint('var(--alert-red)', 10) }}>
      <span className="flex-1">{oai.error}</span>
      <button onClick={() => oai.setError('')} className="text-[var(--text-muted)] hover:text-white" aria-label="Dismiss"><X className="w-3 h-3" /></button>
    </div>
  ) : null;

  const tabs = s ? (
    <RunTabs
      s={s} tab={activeTab} setTab={setTab} oai={oai} engine={engine} keyValue={key} ready={ready}
      selected={selected} onSelect={onSelect} askTarget={askTarget} setAskTarget={setAskTarget} theater={theater}
    />
  ) : null;

  /* ── Full screen: a theatre around the live globe ── */
  if (theater && s && !embedded) {
    const node = (
      <div className="fixed inset-0 z-[900] pointer-events-none">
        <div className="absolute inset-x-0 top-0 h-[84px]" style={{ background: 'linear-gradient(to bottom, color-mix(in srgb, var(--bg-primary) 85%, transparent) 55%, transparent)' }} />
        <div className="absolute inset-x-0 bottom-0 h-[44px]" style={{ background: 'linear-gradient(to top, var(--bg-primary) 55%, transparent)' }} />
        <TheaterTopBar s={s} {...props} />
        <aside className="absolute left-3 top-[76px] bottom-3 w-[360px] pointer-events-auto rounded-xl border border-[var(--border-primary)] flex flex-col overflow-hidden shadow-2xl" style={SOLID}>
          <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4 flex flex-col gap-4">
            {errorBox}
            <Verdict s={s} />
            {s.status === 'running' && oai.canSteer && <InjectBox oai={oai} s={s} />}
            {s.report && <ReportBody s={s} runId={oai.runId} selected={selected} onSelect={onSelect} />}
            {!s.report && <ContextList s={s} selected={selected} onSelect={onSelect} />}
          </div>
          <UsageLine s={s} />
        </aside>
        <aside className="absolute right-3 top-[76px] bottom-3 w-[400px] pointer-events-auto rounded-xl border border-[var(--border-primary)] flex flex-col overflow-hidden shadow-2xl" style={SOLID}>
          {tabs}
        </aside>
        {selection && (
          <div className="absolute bottom-4 left-[384px] right-[424px] flex justify-center pointer-events-none">
            <div className="pointer-events-auto w-full max-w-[560px]">
              <Inspector s={s} sel={selection} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent} floating />
            </div>
          </div>
        )}
        {!selection && (
          <div className="absolute bottom-4 left-[384px] pointer-events-none">
            <Legend />
          </div>
        )}
      </div>
    );
    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
  }

  /* ── Docked, or in the phone drawer ── */
  const header = (
    <div className={`flex items-center gap-2 ${embedded ? 'pb-2' : 'px-3 py-2.5 border-b border-[var(--border-secondary)]'}`}>
      {embedded ? (
        // The phone drawer already names OAI: keep only what this panel adds.
        <span className="text-[9px] font-mono tracking-[0.16em] text-[var(--text-muted)] truncate">SWARM FORECASTING · YOUR OWN KEY</span>
      ) : (
        <>
          <Orbit className="w-4 h-4 flex-shrink-0" style={{ color: ACCENT }} />
          <span className="hud-text text-[12px] tracking-[0.24em] text-[var(--text-primary)]">OAI</span>
          <span className="text-[9px] font-mono tracking-[0.16em] text-[var(--text-muted)] truncate">SWARM FORECASTING</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton title={showHistory ? 'Back' : 'Your forecasts'} onClick={() => setShowHistory(v => !v)} active={showHistory}><History className="w-3.5 h-3.5" /></IconButton>
        {s && <IconButton title="New forecast" onClick={() => { oai.clear(); onSelect(null); setShowHistory(false); setTab(null); }}><Plus className="w-3.5 h-3.5" /></IconButton>}
        {!embedded && s && props.onTheater && <IconButton title="Full screen around the globe" onClick={() => props.onTheater?.(true)}><Maximize2 className="w-3.5 h-3.5" /></IconButton>}
        {props.onClose && !embedded && <IconButton title="Close (the run keeps going)" onClick={props.onClose}><X className="w-3.5 h-3.5" /></IconButton>}
      </div>
    </div>
  );

  const body = (
    <div className="flex flex-col gap-3">
      {engineCard}
      {errorBox}
      {showHistory ? (
        <HistoryList oai={oai} onPick={id => { setShowHistory(false); setTab(null); onSelect(null); void oai.watch(id); }} />
      ) : !s ? (
        <AskForm ready={ready} providerName={info.name} onRun={async (input) => {
          const id = await oai.start(input, engine, key);
          if (id) { setShowHistory(false); setTab(null); onSelect(null); }
          return Boolean(id);
        }} />
      ) : (
        <>
          <RunSummary s={s} oai={oai} focus={props.focus} onFocus={props.onFocus} following={props.following} onFollow={props.onFollow} />
          <Verdict s={s} />
          {selection && <Inspector s={s} sel={selection} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent} />}
          {s.status === 'running' && oai.canSteer && <InjectBox oai={oai} s={s} />}
          <div className="rounded-lg border border-[var(--border-primary)] bg-black/20 overflow-hidden">{tabs}</div>
          <UsageLine s={s} />
        </>
      )}
    </div>
  );

  if (embedded) return <div className="flex flex-col">{header}<div className="pt-3">{body}</div></div>;

  return (
    <div className="glass-panel rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      {header}
      <div className="p-3 min-h-0 overflow-y-auto styled-scrollbar">{body}</div>
    </div>
  );
}

/* ───────────────────────────── Atoms ───────────────────────────── */

function IconButton({ children, title, onClick, active }: { children: ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${active ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/[0.06]'}`}>
      {children}
    </button>
  );
}

function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-[var(--text-muted)]">{children}</span>
      <span className="flex-1 h-px bg-[var(--border-secondary)]" />
      {right}
    </div>
  );
}

function Chip({ children, color }: { children: ReactNode; color?: string }) {
  const c = color ?? 'var(--text-secondary)';
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9px] font-mono tracking-wider uppercase border whitespace-nowrap"
      style={{ color: c, borderColor: tint(c, 35), background: tint(c, 8) }}>
      {children}
    </span>
  );
}

function TextButton({ children, onClick, title, tone }: { children: ReactNode; onClick: () => void; title?: string; tone?: 'danger' }) {
  return (
    <button onClick={onClick} title={title}
      className={`inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] transition-colors ${tone === 'danger' ? 'hover:text-[var(--alert-red)]' : 'hover:text-white'}`}>
      {children}
    </button>
  );
}

/* ───────────────────────────── Setup ───────────────────────────── */

function EngineCard({ engine, setEngine, keyValue, setKey, open, setOpen }: {
  engine: Engine; setEngine: (e: Engine) => void; keyValue: string; setKey: (k: string) => void; open: boolean; setOpen: (v: boolean) => void;
}) {
  const info = providerInfo(engine.provider);
  const [reveal, setReveal] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });
  const [filter, setFilter] = useState('');

  const pickProvider = (id: ProviderId) => {
    const next = { ...engine, provider: id, model: providerInfo(id).defaultModel };
    setEngine(next);
    saveEngine(next);
    setKey(loadKey(id));
    setModels(null);
    setStatus({ kind: 'idle', text: '' });
  };

  const check = async () => {
    setStatus({ kind: 'checking', text: '' });
    saveKey(engine.provider, keyValue, engine.remember);
    const out = await checkKey(engine.provider, keyValue);
    if ('error' in out) { setStatus({ kind: 'error', text: out.error }); return; }
    setModels(out.models);
    const model = out.models.some(m => m.id === engine.model) ? engine.model : out.preferred || engine.model;
    const next = { ...engine, model };
    setEngine(next);
    saveEngine(next);
    setStatus({ kind: 'ok', text: `Key accepted · ${out.models.length} model${out.models.length === 1 ? '' : 's'} available` });
  };

  const shown = useMemo(() => {
    const list = models ?? info.suggested.map(id => ({ id, name: id }));
    const f = filter.trim().toLowerCase();
    const hit = f ? list.filter(m => m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f)) : list;
    return hit.some(m => m.id === engine.model) ? hit : [{ id: engine.model, name: engine.model }, ...hit];
  }, [models, info.suggested, filter, engine.model]);

  const ready = !info.needsKey || keyValue.length > 0;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-md border border-[var(--border-primary)] bg-black/20 px-3 py-2 flex items-center gap-2 text-left hover:border-[var(--border-active)] transition-colors">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ready ? 'var(--alert-green)' : 'var(--alert-orange)' }} />
        <span className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">ENGINE</span>
        <span className="text-[11px] text-[var(--text-primary)] truncate">{info.name}</span>
        <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{engine.model}</span>
        <span className="ml-auto text-[9px] text-[var(--text-muted)]">{ready ? 'change' : 'add key'}</span>
      </button>
    );
  }

  return (
    <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3">
      <Label right={ready ? <TextButton onClick={() => setOpen(false)}>done</TextButton> : undefined}>Engine · your own key</Label>
      <div className="grid grid-cols-3 gap-1">
        {PROVIDERS.map(p => {
          const on = engine.provider === p.id;
          return (
            <button key={p.id} onClick={() => pickProvider(p.id)} title={p.name}
              className={`px-1.5 py-1.5 rounded text-[10px] border transition-colors truncate ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] border-transparent bg-white/[0.03] hover:bg-white/[0.07]'}`}
              style={on ? { borderColor: tint(ACCENT, 60), background: tint(ACCENT, 12) } : undefined}>
              {p.name.replace(' (Alibaba Cloud)', '').replace(' (scripted, dev only)', '')}
            </button>
          );
        })}
      </div>

      {info.needsKey ? (
        <>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="relative flex-1">
              <KeyRound className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type={reveal ? 'text' : 'password'} value={keyValue} onChange={e => { setKey(e.target.value.trim()); setStatus({ kind: 'idle', text: '' }); }}
                placeholder={`${info.name} key (${info.keyHint})`} autoComplete="off" spellCheck={false}
                data-1p-ignore data-lpignore="true" aria-label={`${info.name} API key`}
                className="w-full bg-black/40 border border-[var(--border-primary)] rounded pl-6 pr-7 py-1.5 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]"
              />
              <button onClick={() => setReveal(v => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white" aria-label={reveal ? 'Hide key' : 'Show key'}>
                {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <button onClick={check} disabled={!keyValue || status.kind === 'checking'}
              className="h-[30px] px-3 rounded text-[10px] font-mono tracking-[0.14em] border transition-colors disabled:opacity-40 hover:bg-white/[0.05]"
              style={{ borderColor: tint(ACCENT, 55), color: ACCENT }}>
              {status.kind === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'CHECK'}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1.5 text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={engine.remember} onChange={e => {
                const next = { ...engine, remember: e.target.checked };
                setEngine(next); saveEngine(next); saveKey(engine.provider, keyValue, next.remember);
              }} className="accent-[var(--gold-primary)]" />
              Remember on this device
            </label>
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-white">Get a key ↗</a>
            {keyValue && <span className="ml-auto"><TextButton tone="danger" onClick={() => { forgetKey(engine.provider); setKey(''); setModels(null); setStatus({ kind: 'idle', text: '' }); }}>forget key</TextButton></span>}
          </div>
        </>
      ) : (
        <p className="mt-3 text-[10px] text-[var(--text-secondary)]">Scripted answers for trying the pipeline on a development server. No key, no cost, no real analysis.</p>
      )}

      {status.text && (
        <p className="mt-2 text-[10px]" style={{ color: status.kind === 'error' ? 'var(--alert-red)' : 'var(--alert-green)' }}>
          {status.kind === 'ok' && <Check className="w-3 h-3 inline mr-1 -mt-px" />}{status.text}
        </p>
      )}

      <div className="mt-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">MODEL</span>
          {(models?.length ?? 0) > 12 && (
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" aria-label="Filter models"
              className="ml-auto w-28 bg-black/40 border border-[var(--border-primary)] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] focus:outline-none" />
          )}
        </div>
        <select value={engine.model} onChange={e => { const next = { ...engine, model: e.target.value }; setEngine(next); saveEngine(next); }} aria-label="Model"
          className="w-full bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-active)]">
          {shown.map(m => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
        </select>
        {!models && info.needsKey && <p className="mt-1 text-[9px] text-[var(--text-muted)]">Check the key to list every model it can use.</p>}
      </div>

      {info.needsKey && (
        <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-muted)]">
          The key stays in this browser{engine.remember ? '' : ' tab'} and reaches OSIRIS only inside your requests, which pass it to {info.name} for your run. It is never stored on the server or logged. A forecast makes about 15 to 70 model calls, billed to your {info.name} account.
        </p>
      )}
    </section>
  );
}

function AskForm({ ready, providerName, onRun }: { ready: boolean; providerName: string; onRun: (input: { question: string; seed: string; depth: Depth; useFeeds: boolean }) => Promise<boolean> }) {
  const [question, setQuestion] = useState('');
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [depth, setDepth] = useState<Depth>('standard');
  const [useFeeds, setUseFeeds] = useState(true);
  const [starting, setStarting] = useState(false);
  const valid = question.trim().length >= 8;
  const run = async () => {
    if (!ready || !valid || starting) return;
    setStarting(true);
    const ok = await onRun({ question: question.trim(), seed, depth, useFeeds });
    setStarting(false);
    if (ok) { setQuestion(''); setSeed(''); }
  };
  return (
    <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3">
      <Label>Ask</Label>
      <textarea
        value={question} onChange={e => setQuestion(e.target.value.slice(0, 500))} rows={3}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run(); }}
        placeholder="Will … by …?   Which … ?   How much … ?" aria-label="Your question"
        className="w-full resize-none bg-black/40 border border-[var(--border-primary)] rounded-md px-2.5 py-2 text-[12px] leading-snug text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]"
      />
      {!question && (
        <div className="mt-1.5 flex flex-col">
          {EXAMPLES.map(q => (
            <button key={q} onClick={() => setQuestion(q)} className="text-left text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] py-1 border-b border-white/[0.04] last:border-0 truncate transition-colors">
              {q}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[9px] text-[var(--text-muted)] leading-relaxed">
        Yes-or-no questions get a probability, a choice between outcomes gets a share for each, and a quantity gets an estimate with a range.
      </p>

      <button onClick={() => setShowSeed(!showSeed)} className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-white">
        {showSeed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Add your own material {seed && `(${seed.length.toLocaleString()} chars)`}
      </button>
      {showSeed && (
        <textarea value={seed} onChange={e => setSeed(e.target.value.slice(0, 20_000))} rows={5} aria-label="Your material"
          placeholder="Paste a report, notes, a policy draft. The panel reads it alongside the live feeds."
          className="mt-1 w-full resize-y bg-black/40 border border-[var(--border-primary)] rounded-md px-2.5 py-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]" />
      )}

      <div className="mt-3 grid grid-cols-3 gap-1">
        {(Object.keys(DEPTHS) as Depth[]).map(d => {
          const on = depth === d;
          return (
            <button key={d} onClick={() => setDepth(d)}
              className={`rounded-md border px-2 py-1.5 text-left transition-colors ${on ? '' : 'border-[var(--border-primary)] hover:bg-white/[0.04]'}`}
              style={on ? { borderColor: tint(ACCENT, 60), background: tint(ACCENT, 10) } : undefined}>
              <div className="text-[10px] font-mono tracking-[0.14em]" style={{ color: on ? ACCENT : 'var(--text-secondary)' }}>{DEPTHS[d].label.toUpperCase()}</div>
              <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{DEPTHS[d].agents} × {DEPTHS[d].rounds} rounds</div>
              <div className="text-[9px] text-[var(--text-muted)]">≈ {estimateCalls(d)} calls</div>
            </button>
          );
        })}
      </div>

      <label className="mt-2.5 flex items-center gap-2 text-[10px] text-[var(--text-secondary)] cursor-pointer">
        <input type="checkbox" checked={useFeeds} onChange={e => setUseFeeds(e.target.checked)} className="accent-[var(--gold-primary)]" />
        Ground it in the live OSIRIS feeds
      </label>

      <button onClick={run} disabled={!ready || !valid || starting}
        className="mt-3 w-full h-9 rounded-md text-[11px] font-mono font-semibold tracking-[0.22em] transition-opacity disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:opacity-90"
        style={{ background: ACCENT, color: 'var(--bg-primary)' }}>
        {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Orbit className="w-3.5 h-3.5" />}
        RUN FORECAST
      </button>
      {!ready && <p className="mt-1.5 text-[10px]" style={{ color: 'var(--alert-orange)' }}>Add your {providerName} key above to turn the engine on.</p>}

      <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-muted)]">
        A simulated panel debates the question in rounds while the analysis draws itself on the globe. Method after{' '}
        <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-white">MiroFish</a>, rebuilt for OSIRIS. Also on the{' '}
        <a href="/docs#oai" className="underline decoration-dotted hover:text-white">API and MCP</a>. A simulation, not a guarantee.
      </p>
    </section>
  );
}

/* ───────────────────────────── The run ───────────────────────────── */

function Stepper({ s, compact = false }: { s: RunState; compact?: boolean }) {
  const at = s.status === 'done' ? PHASES.length : PHASES.findIndex(p => p.id === s.phase);
  return (
    <div className={`flex items-end gap-1 ${compact ? 'w-[300px]' : ''}`}>
      {PHASES.map((p, i) => {
        const done = i < at;
        const now = i === at && s.status === 'running';
        return (
          <div key={p.id} className="flex-1 flex flex-col gap-1">
            <span className={`text-[8px] font-mono tracking-[0.14em] uppercase ${now ? 'text-[var(--text-primary)]' : done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>{p.label}</span>
            <span className="h-[2px] rounded-full overflow-hidden bg-white/[0.08]">
              <span className={`block h-full ${now ? 'animate-pulse' : ''}`} style={{ width: done || now ? '100%' : '0%', background: done ? ACCENT : tint(ACCENT, 60), transition: 'width .6s ease' }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusLine({ s }: { s: RunState }) {
  if (s.status === 'running') {
    const thinking = Object.keys(s.thinking).length;
    return (
      <p className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: ACCENT }} />
        <span className="truncate min-w-0">{s.phaseLabel || 'Starting'}</span>
        {thinking > 0 && <span className="text-[var(--text-muted)] whitespace-nowrap">· {thinking} thinking</span>}
      </p>
    );
  }
  if (s.status === 'failed') return <p className="text-[11px]" style={{ color: 'var(--alert-red)' }}>{s.message || 'The run failed.'}</p>;
  if (s.status === 'cancelled') return <p className="text-[11px] text-[var(--text-muted)]">Stopped.</p>;
  return null;
}

function CameraChip({ following, onFollow }: { following?: boolean; onFollow?: () => void }) {
  if (following === undefined || !onFollow) return null;
  return following ? (
    <span className="inline-flex items-center gap-1 text-[9px] text-[var(--text-muted)]" title="The camera follows the run. Move the map to take over.">
      <Camera className="w-3 h-3" /> following
    </span>
  ) : (
    <TextButton onClick={onFollow} title="Let the camera follow the run again"><Camera className="w-3 h-3" /> follow</TextButton>
  );
}

function RunSummary({ s, oai, focus, onFocus, following, onFollow }: { s: RunState; oai: OaiClient; focus?: boolean; onFocus?: () => void; following?: boolean; onFollow?: () => void }) {
  return (
    <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3 flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[12px] leading-snug text-[var(--text-primary)]">{s.question}</p>
        {s.frame && <Chip color={ACCENT}>{KIND_LABEL[s.frame.kind]}</Chip>}
      </div>
      {s.frame && s.frame.proposition !== s.question && (
        <p className="text-[10px] leading-snug text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">{s.frame.kind === 'binary' ? 'Resolves YES if ' : 'Framed as '}</span>{s.frame.proposition}
          {s.frame.horizon && <span className="text-[var(--text-muted)]"> · by {s.frame.horizon}</span>}
        </p>
      )}
      <Stepper s={s} />
      <StatusLine s={s} />
      <div className="flex items-center justify-end gap-3">
        <CameraChip following={following} onFollow={onFollow} />
        {onFocus && (
          <TextButton onClick={onFocus} title={focus ? 'Bring the other map layers back' : 'Hide the other map layers so the analysis stands out'}>
            <Crosshair className="w-3 h-3" style={focus ? { color: ACCENT } : undefined} /> {focus ? 'focused' : 'focus'}
          </TextButton>
        )}
        {s.status === 'running' && oai.canSteer && <TextButton tone="danger" onClick={() => oai.cancel()}><Square className="w-2.5 h-2.5" /> stop</TextButton>}
      </div>
    </section>
  );
}

function TheaterTopBar({ s, oai, onTheater, focus, onFocus, following, onFollow }: OaiPanelProps & { s: RunState }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?oai=${oai.runId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <header className="absolute left-3 right-3 top-3 h-[56px] pointer-events-auto rounded-xl border border-[var(--border-primary)] flex items-center gap-4 px-4 shadow-2xl" style={SOLID}>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Orbit className="w-4 h-4" style={{ color: ACCENT }} />
        <span className="hud-text text-[13px] tracking-[0.26em] text-[var(--text-primary)]">OAI</span>
      </div>
      <span className="w-px h-6 bg-[var(--border-secondary)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[var(--text-primary)] truncate">{s.question}</p>
        <div className="mt-0.5"><StatusLine s={s} /></div>
      </div>
      {s.frame && <Chip color={ACCENT}>{KIND_LABEL[s.frame.kind]}</Chip>}
      <Stepper s={s} compact />
      <span className="w-px h-6 bg-[var(--border-secondary)]" />
      <div className="flex items-center gap-3 flex-shrink-0">
        <CameraChip following={following} onFollow={onFollow} />
        {onFocus && (
          <TextButton onClick={onFocus} title={focus ? 'Bring the other map layers back' : 'Hide the other map layers'}>
            <Crosshair className="w-3 h-3" style={focus ? { color: ACCENT } : undefined} /> {focus ? 'focused' : 'focus'}
          </TextButton>
        )}
        {s.status === 'running' && oai.canSteer && <TextButton tone="danger" onClick={() => oai.cancel()}><Square className="w-2.5 h-2.5" /> stop</TextButton>}
        <TextButton onClick={share} title="Copy a link that replays this run">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} link</TextButton>
        <IconButton title="Leave full screen (Esc)" onClick={() => onTheater?.(false)}><Minimize2 className="w-4 h-4" /></IconButton>
      </div>
    </header>
  );
}

/* ───────────────────────────── The verdict ───────────────────────────── */

function Verdict({ s }: { s: RunState }) {
  const frame = s.frame;
  const last = s.rounds[s.rounds.length - 1] ?? null;
  const final = Boolean(s.report);
  const caption = final ? 'Final' : last ? `After round ${last.round} of ${s.roundsPlanned}` : s.status === 'running' ? 'Forming' : '';

  let figure: ReactNode = <span className="text-[var(--text-muted)]">—</span>;
  let sub = '';
  let detail: ReactNode = null;

  if (frame?.kind === 'choice') {
    const shares = s.report?.shares ?? last?.shares ?? null;
    const lead = shares ? leader(shares) : -1;
    if (shares) { figure = <span>{pct(shares[lead])}</span>; sub = frame.outcomes[lead] ?? ''; }
    detail = (
      <div className="flex flex-col gap-1.5 mt-3">
        {frame.outcomes.map((o, i) => {
          const v = shares?.[i] ?? null;
          return (
            <div key={o} className="grid grid-cols-[1fr_auto] gap-x-2 items-center">
              <span className={`text-[10px] truncate ${i === lead ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{o}</span>
              <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)]">{pct(v)}</span>
              <span className="col-span-2 h-1 rounded-full bg-white/[0.06] relative overflow-hidden">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(v ?? 0) * 100}%`, background: outcomeColor(i), opacity: i === lead ? 1 : 0.65, transition: 'width .6s ease' }} />
                {frame.prior[i] !== undefined && <span className="absolute -top-0.5 w-px h-2 bg-white/50" style={{ left: `${frame.prior[i] * 100}%` }} title={`Prior ${pct(frame.prior[i])}`} />}
              </span>
            </div>
          );
        })}
      </div>
    );
  } else if (frame?.kind === 'number') {
    const e = s.report?.estimate ?? (last?.value ? { value: last.value.median, low: last.value.low, high: last.value.high } : null);
    if (e) { figure = <span>{formatAmount(e.value)}</span>; sub = frame.unit; }
    if (e) {
      const lo = Math.min(e.low, frame.anchor ?? e.low, last?.value?.min ?? e.low);
      const hi = Math.max(e.high, frame.anchor ?? e.high, last?.value?.max ?? e.high);
      const at = (v: number) => `${hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50}%`;
      detail = (
        <div className="mt-3">
          <div className="relative h-5">
            <span className="absolute top-2 inset-x-0 h-px bg-white/10" />
            <span className="absolute top-[7px] h-[3px] rounded-full" style={{ left: at(e.low), width: `calc(${at(e.high)} - ${at(e.low)})`, background: tint(ACCENT, 70) }} />
            <span className="absolute top-[3px] w-[2px] h-[11px] rounded bg-white" style={{ left: at(e.value) }} />
            {frame.anchor !== null && <span className="absolute top-[5px] w-px h-[7px] bg-white/45" style={{ left: at(frame.anchor) }} title={`Anchor ${formatAmount(frame.anchor)}`} />}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-[var(--text-muted)] tabular-nums">
            <span>{formatAmount(e.low)}</span>
            <span>80% range</span>
            <span>{formatAmount(e.high)}</span>
          </div>
          {frame.anchor !== null && <p className="mt-1 text-[9px] text-[var(--text-muted)]">Anchor today: <span className="font-mono text-[var(--text-secondary)]">{formatAmount(frame.anchor)}</span></p>}
        </div>
      );
    }
  } else if (frame) {
    const p = s.report?.probability ?? last?.consensus ?? null;
    if (p !== null) { figure = <span>{pct(p)}</span>; sub = 'chance of YES'; }
    detail = (
      <div className="mt-3">
        <div className="relative h-4">
          <span className="absolute top-[7px] inset-x-0 h-[2px] rounded-full bg-white/[0.08]" />
          {last && <span className="absolute top-[6px] h-1 rounded-full" style={{ left: `${last.p25 * 100}%`, width: `${Math.max(0.5, (last.p75 - last.p25) * 100)}%`, background: tint(ACCENT, 45) }} title="Middle half of the panel" />}
          {p !== null && <span className="absolute top-[2px] w-[2px] h-3 rounded bg-white" style={{ left: `${p * 100}%`, transition: 'left .6s ease' }} />}
          <span className="absolute top-[4px] w-px h-2 bg-white/40" style={{ left: `${frame.baseRate * 100}%` }} title={`Base rate ${pct(frame.baseRate)}`} />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-[var(--text-muted)]">
          <span>NO</span><span>base rate {pct(frame.baseRate)}</span><span>YES</span>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3">
      <Label right={<span className="text-[9px] font-mono text-[var(--text-muted)]">{caption}</span>}>{final ? 'Forecast' : 'The panel so far'}</Label>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[30px] leading-none font-mono font-semibold tabular-nums text-[var(--text-primary)]">{figure}</div>
          {sub && <div className="mt-1 text-[10px] text-[var(--text-secondary)] truncate">{sub}</div>}
        </div>
        <Trajectory s={s} />
      </div>
      {detail}
    </section>
  );
}

function Trajectory({ s }: { s: RunState }) {
  const W = 128, H = 40;
  const frame = s.frame;
  if (!frame || !s.rounds.length) return <div className="w-[128px] h-[40px]" />;
  const n = s.rounds.length + (s.report ? 1 : 0);
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 6) + 3);

  if (frame.kind === 'number') {
    const pts = s.rounds.map(r => r.value!).filter(Boolean);
    const fin = s.report?.estimate;
    const all = [...pts.flatMap(v => [v.p25, v.p75, v.median]), ...(fin ? [fin.value] : []), ...(frame.anchor !== null ? [frame.anchor] : [])];
    const lo = Math.min(...all), hi = Math.max(...all);
    const y = (v: number) => (hi > lo ? H - 3 - ((v - lo) / (hi - lo)) * (H - 6) : H / 2);
    const band = pts.map((v, i) => `${x(i)},${y(v.p75)}`).join(' ') + ' ' + [...pts].reverse().map((v, j) => `${x(pts.length - 1 - j)},${y(v.p25)}`).join(' ');
    const line = [...pts.map((v, i) => `${x(i)},${y(v.median)}`), ...(fin ? [`${x(n - 1)},${y(fin.value)}`] : [])].join(' ');
    return (
      <svg width={W} height={H} className="flex-shrink-0 overflow-visible" aria-hidden>
        {frame.anchor !== null && <line x1={0} x2={W} y1={y(frame.anchor)} y2={y(frame.anchor)} stroke="rgba(255,255,255,.22)" strokeDasharray="2 3" />}
        {pts.length > 1 && <polygon points={band} fill={tint(ACCENT, 18)} />}
        <polyline points={line} fill="none" stroke={ACCENT} strokeWidth={1.5} />
      </svg>
    );
  }
  if (frame.kind === 'choice') {
    const series = frame.outcomes.map((_, k) => [...s.rounds.map(r => r.shares?.[k] ?? 0), ...(s.report?.shares ? [s.report.shares[k]] : [])]);
    const y = (v: number) => H - 3 - v * (H - 6);
    return (
      <svg width={W} height={H} className="flex-shrink-0 overflow-visible" aria-hidden>
        {series.map((vals, k) => (
          <polyline key={k} points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={outcomeColor(k)} strokeWidth={1.4} opacity={0.9} />
        ))}
      </svg>
    );
  }
  const vals = [...s.rounds.map(r => r.consensus), ...(s.report ? [s.report.probability] : [])];
  const y = (v: number) => H - 3 - v * (H - 6);
  return (
    <svg width={W} height={H} className="flex-shrink-0 overflow-visible" aria-hidden>
      <line x1={0} x2={W} y1={y(frame.baseRate)} y2={y(frame.baseRate)} stroke="rgba(255,255,255,.22)" strokeDasharray="2 3" />
      <line x1={0} x2={W} y1={y(0.5)} y2={y(0.5)} stroke="rgba(255,255,255,.06)" />
      <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={ACCENT} strokeWidth={1.5} />
      {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === vals.length - 1 ? 2.6 : 1.8} fill={ACCENT} />)}
    </svg>
  );
}

/* ───────────────────────────── Steering ───────────────────────────── */

function InjectBox({ oai, s }: { oai: OaiClient; s: RunState }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const late = s.phase === 'report';
  const send = async () => {
    if (text.trim().length < 3) return;
    const err = await oai.inject(text.trim());
    setMsg(err ?? 'Queued. The panel takes it up at the start of the next round.');
    if (!err) setText('');
    setTimeout(() => setMsg(''), 3500);
  };
  return (
    <section>
      <Label>Inject an event</Label>
      <div className="flex gap-1.5">
        <input value={text} onChange={e => setText(e.target.value.slice(0, 400))} onKeyDown={e => e.key === 'Enter' && send()} disabled={late}
          placeholder={late ? 'Too late: the report is being written' : 'e.g. "Talks collapse in Geneva"'} aria-label="Event to inject"
          className="flex-1 bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] disabled:opacity-50" />
        <button onClick={send} disabled={late || text.trim().length < 3} aria-label="Inject event"
          className="px-2.5 rounded border disabled:opacity-40 hover:bg-white/[0.05]" style={{ borderColor: tint(ACCENT, 55), color: ACCENT }}>
          <Zap className="w-3.5 h-3.5" />
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">{msg}</p>}
    </section>
  );
}

/* ───────────────────────────── The report ───────────────────────────── */

function ReportBody({ s, runId, selected, onSelect }: { s: RunState; runId: string | null; selected: string | null; onSelect: (k: string | null) => void }) {
  const r = s.report!;
  const frame = s.frame;
  const [copied, setCopied] = useState('');
  const url = typeof window !== 'undefined' && runId ? `${window.location.origin}/?oai=${runId}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied('link'); setTimeout(() => setCopied(''), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const blob = new Blob([toMarkdown(s, url)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `osiris-oai-${(runId ?? 'forecast').slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const conf = { low: 'var(--alert-orange)', medium: ACCENT, high: 'var(--alert-green)' }[r.confidence];
  const dirColor = (push: 'yes' | 'no') => leanColor(push === 'yes' ? 0.92 : 0.08);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Label right={<span className="flex items-center gap-3"><TextButton onClick={copy}>{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} link</TextButton><TextButton onClick={download}><Download className="w-3 h-3" /> .md</TextButton></span>}>Report</Label>
        <h3 className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{r.headline}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip color={conf}>{r.confidence} confidence</Chip>
          {frame?.kind === 'binary' && <span className="text-[9px] font-mono text-[var(--text-muted)]">panel {pct(r.swarm)} · report {pct(r.probability)}</span>}
        </div>
        {r.deviation && <p className="mt-1.5 text-[10px] italic text-[var(--text-muted)]">{r.deviation}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{r.summary}</p>
      </div>

      {r.drivers.length > 0 && (
        <div>
          <Label>Drivers</Label>
          <div className="flex flex-col gap-1.5">
            {r.drivers.map((d, i) => {
              const word = directionWord(frame, d.push, d.favors);
              const color = frame?.kind === 'choice' && d.favors ? outcomeColor(frame.outcomes.indexOf(d.favors)) : dirColor(d.push);
              const actorKey = d.actor ? `a:${d.actor}` : null;
              return (
                <button key={i} disabled={!actorKey} onClick={() => actorKey && onSelect(actorKey === selected ? null : actorKey)}
                  className="flex items-start gap-2 text-left group disabled:cursor-default">
                  {d.push === 'yes' ? <ArrowUpRight className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color }} /> : <ArrowDownRight className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color }} />}
                  <span className="flex-1 text-[10px] leading-snug text-[var(--text-secondary)] group-enabled:group-hover:text-[var(--text-primary)]">{d.text}</span>
                  <span className="text-[8px] font-mono uppercase tracking-wider mt-0.5" style={{ color }}>{word}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.scenarios.length > 0 && (
        <div>
          <Label>Scenarios</Label>
          <div className="flex flex-col gap-2">
            {r.scenarios.map((sc, i) => {
              const key = `s:${i}`;
              const on = selected === key;
              return (
                <button key={i} onClick={() => onSelect(on ? null : key)} className="text-left group">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] flex-1 truncate ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>{sc.name}</span>
                    <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)]">{pct(sc.probability)}</span>
                  </div>
                  <div className="mt-1 h-[3px] rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${sc.probability * 100}%`, background: on ? ACCENT : tint(ACCENT, 65) }} /></div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.signposts.length > 0 && (
        <div>
          <Label>Signposts to watch</Label>
          <div className="flex flex-col gap-1">
            {r.signposts.map((sp, i) => {
              const key = `p:${i}`;
              const word = directionWord(frame, sp.means, sp.favors);
              return (
                <button key={i} onClick={() => onSelect(selected === key ? null : key)} className="flex items-start gap-2 py-0.5 text-left group">
                  <span className="w-1.5 h-1.5 mt-1 rotate-45 flex-shrink-0" style={{ background: dirColor(sp.means) }} />
                  <span className={`flex-1 text-[10px] leading-snug ${selected === key ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>{sp.text}{sp.place && <span className="text-[var(--text-muted)]"> · {sp.place}</span>}</span>
                  <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] mt-0.5">→ {word}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.dissent && (
        <div className="rounded-md border border-[var(--border-secondary)] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1">Dissent</div>
          <p className="text-[10px] leading-snug text-[var(--text-secondary)]">{r.dissent}</p>
        </div>
      )}
      {r.caveats.length > 0 && <ul className="flex flex-col gap-0.5">{r.caveats.map((c, i) => <li key={i} className="text-[9px] leading-snug text-[var(--text-muted)]">· {c}</li>)}</ul>}
    </section>
  );
}

/* ───────────────────────────── Tabs ───────────────────────────── */

function RunTabs(p: {
  s: RunState; tab: Tab; setTab: (t: Tab) => void; oai: OaiClient; engine: Engine; keyValue: string; ready: boolean;
  selected: string | null; onSelect: (k: string | null) => void; askTarget: string; setAskTarget: (t: string) => void; theater: boolean;
}) {
  const { s, tab, setTab } = p;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    ...(!p.theater && s.report ? [{ id: 'report' as Tab, label: 'Report' }] : []),
    { id: 'debate', label: 'Debate', count: s.posts.length },
    { id: 'panel', label: 'Panel', count: s.agents.length },
    { id: 'world', label: 'World', count: s.actors.length },
    { id: 'ask', label: 'Ask' },
  ];
  const current = tabs.some(t => t.id === tab) ? tab : 'debate';
  return (
    <div className={`flex flex-col ${p.theater ? 'h-full min-h-0' : ''}`}>
      <div role="tablist" className="flex items-stretch border-b border-[var(--border-secondary)] px-1 flex-shrink-0">
        {tabs.map(t => {
          const on = current === t.id;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`relative px-2.5 py-2 text-[10px] font-mono tracking-[0.14em] uppercase transition-colors ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              {t.label}{t.count ? <span className="ml-1 text-[var(--text-muted)]">{t.count}</span> : null}
              {on && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: ACCENT }} />}
            </button>
          );
        })}
      </div>
      <div className={`p-3 ${p.theater ? 'flex-1 min-h-0 overflow-y-auto styled-scrollbar' : ''}`}>
        {current === 'report' && s.report && <ReportBody s={s} runId={p.oai.runId} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'debate' && <DebateList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'panel' && <PanelList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'world' && <WorldList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'ask' && <AskBox s={s} oai={p.oai} engine={p.engine} keyValue={p.keyValue} ready={p.ready} target={p.askTarget} setTarget={p.setAskTarget} />}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[10px] leading-relaxed text-[var(--text-muted)] py-2">{children}</p>;
}

function DebateList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const [limit, setLimit] = useState(30);
  const names = useMemo(() => new Map(s.agents.map(a => [a.id, a])), [s.agents]);
  const range = estimateRange(s);
  type Item = { kind: 'post'; post: Post } | { kind: 'inject'; text: string; round: number } | { kind: 'round'; stat: RoundStat };
  const items: Item[] = [];
  let pi = 0;
  for (let r = 1; r <= Math.max(s.roundsPlanned, 1); r++) {
    for (const inj of s.injects.filter(x => x.round === r)) items.push({ kind: 'inject', text: inj.text, round: r });
    while (pi < s.posts.length && s.posts[pi].round === r) items.push({ kind: 'post', post: s.posts[pi++] });
    const stat = s.rounds.find(x => x.round === r);
    if (stat) items.push({ kind: 'round', stat });
  }
  while (pi < s.posts.length) items.push({ kind: 'post', post: s.posts[pi++] });
  const shown = items.slice().reverse().slice(0, limit);

  if (!s.agents.length) {
    return <Empty>{s.status === 'running' ? 'The panel is being assembled. On the globe, the actors and their relations are drawing in.' : 'No debate in this run.'}</Empty>;
  }
  return (
    <div className="flex flex-col gap-3">
      {shown.map((it, i) => {
        if (it.kind === 'round') {
          return (
            <div key={`r${it.stat.round}`} className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
              Round {it.stat.round} · {s.frame?.kind === 'number' && it.stat.value ? `median ${formatAmount(it.stat.value.median)}` : s.frame?.kind === 'choice' && it.stat.shares ? `${s.frame.outcomes[leader(it.stat.shares)]} ${pct(Math.max(...it.stat.shares))}` : pct(it.stat.consensus)}
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
            </div>
          );
        }
        if (it.kind === 'inject') {
          return (
            <div key={`i${i}`} className="rounded-md px-2.5 py-1.5 text-[10px] text-[var(--text-primary)] flex items-start gap-1.5" style={{ border: `1px solid ${tint(ACCENT, 40)}`, background: tint(ACCENT, 8) }}>
              <Zap className="w-3 h-3 mt-px flex-shrink-0" style={{ color: ACCENT }} />
              <span><span className="text-[var(--text-muted)]">Injected before round {it.round}: </span>{it.text}</span>
            </div>
          );
        }
        const p = it.post;
        const a = names.get(p.agent);
        const key = `g:${p.agent}`;
        return (
          <div key={p.id} className={`flex gap-2 rounded-md -mx-1 px-1 py-0.5 ${selected === key ? 'bg-white/[0.05]' : ''}`}>
            <button onClick={() => onSelect(selected === key ? null : key)} className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 mt-0.5"
              style={{ background: agentTint(s, p, range), color: '#0b0b10' }} aria-label={`Select ${a?.name ?? p.agent}`}>
              {initials(a?.name ?? '?')}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <button onClick={() => onSelect(selected === key ? null : key)} className="text-[10px] font-medium text-[var(--text-primary)] hover:underline truncate">{a?.name ?? p.agent}</button>
                <span className="text-[9px] text-[var(--text-muted)] truncate">{a?.role}</span>
                <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-primary)] whitespace-nowrap">{postView(p, s.frame)}</span>
              </div>
              <p className="text-[10px] leading-snug text-[var(--text-secondary)] mt-0.5">{p.text}</p>
              {p.replies.map((r, j) => {
                const linkKey = `link:rp:${p.agent}:${r.to}`;
                return (
                  <button key={j} onClick={() => onSelect(selected === linkKey ? null : linkKey)} className="block text-left text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-0.5">
                    ↳ {r.stance === 'agree' ? 'agrees with' : r.stance === 'disagree' ? 'disputes' : 'questions'} <span className="text-[var(--text-secondary)]">{names.get(r.to)?.name ?? r.to}</span>{r.point && <>: “{r.point}”</>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {items.length > limit && <button onClick={() => setLimit(l => l + 30)} className="text-[10px] text-[var(--text-muted)] hover:text-white">Show earlier</button>}
    </div>
  );
}

function PanelList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const latest = latestPosts(s);
  const range = estimateRange(s);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selected?.startsWith('g:')) refs.current.get(selected.slice(2))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!s.agents.length) return <Empty>The panel has not been assembled yet.</Empty>;
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-1 mb-1.5 text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        {s.frame?.kind === 'choice'
          ? s.frame.outcomes.map((o, i) => <span key={o} className="inline-flex items-center gap-1 ml-2"><span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(i) }} />{o}</span>)
          : <><span style={{ color: leanColor(0) }}>{s.frame?.kind === 'number' ? 'lower' : 'no'}</span><span className="w-12 h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${leanColor(0)}, ${leanColor(0.5)}, ${leanColor(1)})` }} /><span style={{ color: leanColor(1) }}>{s.frame?.kind === 'number' ? 'higher' : 'yes'}</span></>}
      </div>
      {s.agents.map(a => {
        const post = latest.get(a.id);
        const thinking = a.id in s.thinking;
        const key = `g:${a.id}`;
        const on = selected === key;
        return (
          <button key={a.id} ref={el => { if (el) refs.current.set(a.id, el); }} onClick={() => onSelect(on ? null : key)}
            className={`flex items-center gap-2 px-1.5 py-1.5 rounded text-left transition-colors ${on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agentTint(s, post, range), boxShadow: thinking ? `0 0 0 3px ${tint(ACCENT, 25)}` : undefined }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] text-[var(--text-primary)] truncate">{a.name}</span>
              <span className="block text-[9px] text-[var(--text-muted)] truncate">{a.role}{a.place && ` · ${a.place}`}</span>
            </span>
            {thinking ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: ACCENT }} /> : <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)] whitespace-nowrap">{post ? postView(post, s.frame) : '—'}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The line styles on the globe, as a key. */
function Legend({ inline = false }: { inline?: boolean }) {
  const rows: { label: string; dash: string; opacity?: number }[] = [
    { label: 'aligned · agrees', dash: '' },
    { label: 'opposed · disputes', dash: '7 4' },
    { label: 'evidence', dash: '1.5 3', opacity: 0.7 },
    { label: 'weighing an actor', dash: '4 3', opacity: 0.8 },
  ];
  return (
    <div className={`${inline ? '' : 'rounded-lg border border-[var(--border-primary)] px-3 py-2'} flex ${inline ? 'flex-wrap gap-x-4 gap-y-1' : 'flex-col gap-1'}`} style={inline ? undefined : SOLID}>
      {rows.map(r => (
        <span key={r.label} className="inline-flex items-center gap-2 text-[9px] text-[var(--text-muted)]">
          <svg width="26" height="6" aria-hidden><line x1="1" x2="25" y1="3" y2="3" stroke="var(--map-oai, #fff)" strokeWidth="1.6" strokeDasharray={r.dash} opacity={r.opacity ?? 1} strokeLinecap="round" /></svg>
          {r.label}
        </span>
      ))}
    </div>
  );
}

function WorldList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const relations = s.links.filter(l => l.kind === 'relation');
  const evidence = s.links.filter(l => l.kind === 'evidence');
  if (!s.actors.length) return <Empty>The world model is being mapped.</Empty>;
  const row = (key: string, children: ReactNode) => (
    <button key={key} onClick={() => onSelect(selected === key ? null : key)}
      className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left transition-colors ${selected === key ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
      {children}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <Legend inline />
      <div>
        <Label>Actors · {s.actors.length}</Label>
        {s.actors.map(a => row(`a:${a.id}`, (
          <>
            <span className="w-2 h-2 rounded-full flex-shrink-0 border border-white/70" style={{ background: s.frame?.kind === 'choice' ? 'transparent' : leanColor(0.5 + a.lean / 2) }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] text-[var(--text-primary)] truncate">{a.name}</span>
              <span className="block text-[9px] text-[var(--text-muted)] truncate">{a.role}</span>
            </span>
            <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">{a.kind}</span>
          </>
        )))}
      </div>
      {relations.length > 0 && (
        <div>
          <Label>Relations · {relations.length}</Label>
          {relations.map(l => row(`link:${l.id}`, (
            <>
              <LineGlyph link={l} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] text-[var(--text-primary)] truncate">{nodeName(s, l.from)} ⇄ {nodeName(s, l.to)}</span>
                <span className="block text-[9px] text-[var(--text-muted)] truncate">{l.label}</span>
              </span>
            </>
          )))}
        </div>
      )}
      <ContextList s={s} selected={selected} onSelect={onSelect} evidence={evidence} />
    </div>
  );
}

function LineGlyph({ link }: { link: Link }) {
  const dash = link.kind === 'evidence' ? '1.5 3' : link.kind === 'focus' ? '4 3' : link.tone === 'oppose' ? '6 4' : link.tone === 'neutral' ? '2 3' : '';
  return <svg width="20" height="6" className="flex-shrink-0" aria-hidden><line x1="1" x2="19" y1="3" y2="3" stroke="var(--map-oai, #fff)" strokeWidth="1.6" strokeDasharray={dash} strokeLinecap="round" /></svg>;
}

function ContextList({ s, selected, onSelect, evidence }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void; evidence?: Link[] }) {
  if (!s.context.length) return s.status === 'running' && !s.actors.length ? <Empty>Reading the live feeds.</Empty> : null;
  const cited = new Set((evidence ?? s.links.filter(l => l.kind === 'evidence')).map(l => l.from.slice(2)));
  return (
    <div>
      <Label>Live intelligence · {s.context.length}</Label>
      <div className="flex flex-col">
        {s.context.map((c: ContextItem) => {
          const key = `c:${c.id}`;
          const on = selected === key;
          return (
            <button key={c.id} onClick={() => onSelect(on ? null : key)}
              className={`flex items-start gap-2 px-1.5 py-1 rounded text-left transition-colors ${on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
              <span className="w-1.5 h-1.5 mt-1 rounded-full flex-shrink-0" style={{ background: cited.has(c.id) ? 'var(--map-oai, #fff)' : 'rgba(255,255,255,.25)' }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] leading-snug text-[var(--text-secondary)]">{c.title}</span>
                <span className="block text-[9px] text-[var(--text-muted)] truncate">{[c.source, c.place, ago(c.published)].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AskBox({ s, oai, engine, keyValue, ready, target, setTarget }: { s: RunState; oai: OaiClient; engine: Engine; keyValue: string; ready: boolean; target: string; setTarget: (t: string) => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ who: string; text: string; you: boolean }[]>([]);
  const targetName = target === 'report' ? 'The report agent' : s.agents.find(a => a.id === target)?.name ?? target;
  const send = async () => {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setLog(l => [...l, { who: 'You', text: m, you: true }]);
    setMessage('');
    const out = await oai.ask(target, m, engine, keyValue);
    setLog(l => [...l, { who: targetName, text: out.reply ?? out.error ?? '…', you: false }]);
    setBusy(false);
  };
  if (!s.agents.length) return <Empty>The panel can be questioned once it has been assembled.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Who to ask"
        className="w-full bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[10px] text-[var(--text-primary)] focus:outline-none">
        <option value="report" disabled={!s.report}>The report agent{!s.report ? ' (once the report is written)' : ''}</option>
        {s.agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
      </select>
      {log.length === 0 && <Empty>Ask why the forecast landed where it did, what would change a panelist&apos;s mind, or what to watch next. Questions run on your key.</Empty>}
      {log.length > 0 && (
        <div className="flex flex-col gap-2">
          {log.map((m, i) => (
            <div key={i} className={`rounded-md px-2.5 py-2 text-[10px] leading-relaxed ${m.you ? 'ml-6 bg-white/[0.05] text-[var(--text-primary)]' : 'mr-2 text-[var(--text-secondary)]'}`}
              style={!m.you ? { border: `1px solid ${tint(ACCENT, 28)}`, background: tint(ACCENT, 6) } : undefined}>
              <span className="block text-[8px] font-mono tracking-[0.16em] uppercase text-[var(--text-muted)] mb-0.5">{m.who}</span>
              <span className="whitespace-pre-wrap">{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} onKeyDown={e => e.key === 'Enter' && send()} disabled={!ready || (target === 'report' && !s.report)}
          placeholder={!ready ? 'Add your key to ask' : `Ask ${targetName.replace(/^The /, 'the ')}…`} aria-label="Your question to the panel"
          className="flex-1 bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] disabled:opacity-50" />
        <button onClick={send} disabled={!ready || busy || !message.trim()} aria-label="Send"
          className="px-2.5 rounded border disabled:opacity-40 hover:bg-white/[0.05]" style={{ borderColor: tint(ACCENT, 55), color: ACCENT }}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── The inspector ───────────────────────────── */

function NodeName({ s, k, onSelect }: { s: RunState; k: string; onSelect: (k: string | null) => void }) {
  return <button onClick={() => onSelect(k)} className="text-[var(--text-primary)] hover:underline decoration-dotted">{nodeName(s, k)}</button>;
}

function PostCardView({ s, post, note, range, onSelect }: { s: RunState; post: Post; note?: string; range: [number, number]; onSelect: (k: string | null) => void }) {
  const a = s.agents.find(x => x.id === post.agent);
  return (
    <div className="rounded-md border border-[var(--border-secondary)] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-baseline gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0 self-center" style={{ background: agentTint(s, post, range) }} />
        <button onClick={() => onSelect(`g:${post.agent}`)} className="text-[10px] font-medium text-[var(--text-primary)] hover:underline truncate">{a?.name ?? post.agent}</button>
        <span className="text-[9px] text-[var(--text-muted)]">{note ?? `round ${post.round}`}</span>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-primary)] whitespace-nowrap">{postView(post, s.frame)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[var(--text-secondary)]">{post.text}</p>
      {post.reasoning && <p className="mt-1 text-[9px] leading-snug text-[var(--text-muted)] italic">{post.reasoning}</p>}
      {post.changed && post.changed.toLowerCase() !== 'nothing' && <p className="mt-1 text-[9px] text-[var(--text-muted)]">Moved by: {post.changed}</p>}
    </div>
  );
}

function Inspector({ s, sel, onSelect, onLocate, onAsk, floating = false }: {
  s: RunState; sel: Selection; onSelect: (k: string | null) => void; onLocate: OaiPanelProps['onLocate']; onAsk: (agentId: string) => void; floating?: boolean;
}) {
  const range = estimateRange(s);
  const place = (k: string) => {
    const [prefix, ...rest] = k.split(':');
    const id = rest.join(':');
    const n = prefix === 'a' ? s.actors.find(a => a.id === id) : prefix === 'g' ? s.agents.find(a => a.id === id) : prefix === 'c' ? s.context.find(c => c.id === id) : null;
    return n && n.lat !== null && n.lng !== null ? { lat: n.lat, lng: n.lng } : null;
  };

  let kicker = '';
  let title: ReactNode = null;
  let body: ReactNode = null;
  let locate: { lat: number; lng: number; zoom: number } | null = null;

  switch (sel.type) {
    case 'link': {
      const l = sel.link;
      const a = place(l.from), b = place(l.to);
      if (a && b) locate = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2, zoom: 2.2 };
      if (l.kind === 'relation') {
        kicker = 'Relation';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="text-[var(--text-muted)]">⇄</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const actors = [l.from, l.to].map(k => s.actors.find(x => `a:${x.id}` === k)).filter(Boolean);
        body = (
          <>
            <div className="flex items-center gap-2">
              <Chip>{l.tone === 'support' ? 'aligned' : l.tone === 'oppose' ? 'opposed' : 'linked'}</Chip>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">strength</span>
              <span className="w-16 h-1 rounded-full bg-white/[0.08] overflow-hidden"><span className="block h-full" style={{ width: `${l.strength * 100}%`, background: 'var(--map-oai, #fff)' }} /></span>
            </div>
            <p className="text-[11px] leading-snug text-[var(--text-secondary)]">{l.label}</p>
            <div className="grid grid-cols-2 gap-2">
              {actors.map(x => (
                <div key={x!.id} className="rounded-md border border-[var(--border-secondary)] px-2 py-1.5">
                  <div className="text-[10px] text-[var(--text-primary)] truncate">{x!.name}</div>
                  <div className="text-[9px] text-[var(--text-muted)] leading-snug line-clamp-2">{x!.role}</div>
                </div>
              ))}
            </div>
          </>
        );
      } else if (l.kind === 'evidence') {
        kicker = 'Evidence';
        const item = s.context.find(c => `c:${c.id}` === l.from);
        title = <span>{item?.title ?? nodeName(s, l.from)}</span>;
        const effect = s.frame?.kind === 'number' ? (l.tone === 'support' ? 'points higher' : l.tone === 'oppose' ? 'points lower' : 'bears on') : l.tone === 'support' ? 'points toward YES' : l.tone === 'oppose' ? 'points toward NO' : 'bears on';
        body = (
          <>
            {item && <p className="text-[9px] text-[var(--text-muted)]">{[item.source, item.place, ago(item.published)].filter(Boolean).join(' · ')}</p>}
            <p className="text-[11px] text-[var(--text-secondary)]">{effect[0].toUpperCase() + effect.slice(1)}{effect === 'bears on' ? '' : ','} {effect === 'bears on' ? '' : 'through '}<NodeName s={s} k={l.to} onSelect={onSelect} /></p>
            {l.label && <p className="text-[10px] leading-snug text-[var(--text-muted)]">{l.label}</p>}
          </>
        );
      } else if (l.kind === 'reply') {
        kicker = `Exchange · round ${l.round}`;
        const verb = l.tone === 'support' ? 'agrees with' : l.tone === 'oppose' ? 'disputes' : 'questions';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="text-[var(--text-muted)] font-normal">{verb}</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const said = postFor(s, l);
        const answered = s.posts.filter(p => `g:${p.agent}` === l.to && p.round === l.round - 1)[0] ?? s.posts.filter(p => `g:${p.agent}` === l.to && p.round <= l.round).at(-1);
        body = (
          <>
            {l.label && <p className="text-[11px] leading-snug text-[var(--text-primary)]">“{l.label}”</p>}
            {answered && <PostCardView s={s} range={range} onSelect={onSelect} post={answered} note={`said, round ${answered.round}`} />}
            {said && <PostCardView s={s} range={range} onSelect={onSelect} post={said} note={`replied, round ${said.round}`} />}
          </>
        );
      } else {
        kicker = l.round ? `Weighing · round ${l.round}` : 'Watching';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="text-[var(--text-muted)] font-normal">{l.round ? 'weighing' : 'watches'}</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const said = postFor(s, l);
        const actor = s.actors.find(x => `a:${x.id}` === l.to);
        body = (
          <>
            {actor && <p className="text-[10px] leading-snug text-[var(--text-muted)]">{actor.role}</p>}
            {said && <PostCardView s={s} range={range} onSelect={onSelect} post={said} />}
          </>
        );
      }
      break;
    }
    case 'actor': {
      const a = sel.actor;
      if (a.lat !== null && a.lng !== null) locate = { lat: a.lat, lng: a.lng, zoom: 3.5 };
      kicker = `Actor · ${a.kind}`;
      title = <span>{a.name}</span>;
      const rel = s.links.filter(l => l.kind === 'relation' && (l.from === sel.key || l.to === sel.key));
      const ev = s.links.filter(l => l.kind === 'evidence' && l.to === sel.key);
      const watchers = [...new Set(s.links.filter(l => l.kind === 'focus' && l.to === sel.key).map(l => l.from))];
      body = (
        <>
          <p className="text-[11px] leading-snug text-[var(--text-secondary)]">{a.role}</p>
          {a.place && <p className="text-[9px] text-[var(--text-muted)]">{a.place}</p>}
          {s.frame?.kind !== 'choice' && (
            <div className="flex items-center gap-2 text-[9px] font-mono text-[var(--text-muted)]">
              <span>lean</span>
              <span className="relative w-24 h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${leanColor(0)}, ${leanColor(0.5)}, ${leanColor(1)})` }}>
                <span className="absolute -top-1 w-[2px] h-3 rounded bg-white" style={{ left: `${(0.5 + a.lean / 2) * 100}%` }} />
              </span>
              <span>{s.frame?.kind === 'number' ? (a.lean > 0.15 ? 'pushes higher' : a.lean < -0.15 ? 'pushes lower' : 'balanced') : a.lean > 0.15 ? 'toward YES' : a.lean < -0.15 ? 'toward NO' : 'balanced'}</span>
            </div>
          )}
          {rel.length > 0 && <List label="Relations">{rel.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="flex items-center gap-2 text-left text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <LineGlyph link={l} /> {nodeName(s, l.from === sel.key ? l.to : l.from)}
            </button>
          ))}</List>}
          {ev.length > 0 && <List label="Evidence">{ev.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="text-left text-[10px] leading-snug text-[var(--text-secondary)] hover:text-[var(--text-primary)] line-clamp-2">{nodeName(s, l.from)}</button>
          ))}</List>}
          {watchers.length > 0 && <List label="Panelists weighing it">{
            <div className="flex flex-wrap gap-x-3 gap-y-1">{watchers.map(k => <NodeName key={k} s={s} k={k} onSelect={onSelect} />)}</div>
          }</List>}
        </>
      );
      break;
    }
    case 'agent': {
      const a = sel.agent;
      if (a.lat !== null && a.lng !== null) locate = { lat: a.lat, lng: a.lng, zoom: 3.5 };
      kicker = 'Panelist';
      title = <span>{a.name}</span>;
      const posts = s.posts.filter(p => p.agent === a.id);
      const heard = s.posts.flatMap(p => p.replies.filter(r => r.to === a.id).map(r => ({ from: p.agent, round: p.round, r })));
      body = (
        <>
          <p className="text-[10px] text-[var(--text-secondary)]">{a.role}{a.place && <span className="text-[var(--text-muted)]"> · {a.place}</span>}</p>
          {(a.lens || a.bias) && <p className="text-[9px] leading-snug text-[var(--text-muted)]">{a.lens}{a.bias && <> Watches for: {a.bias}</>}</p>}
          {posts.length === 0 && <p className="text-[10px] text-[var(--text-muted)]">Has not spoken yet.</p>}
          {posts.slice().reverse().map(p => <PostCardView s={s} range={range} onSelect={onSelect} key={p.id} post={p} />)}
          {heard.length > 0 && <List label="What the panel said to them">{heard.slice(-4).reverse().map((h, i) => (
            <p key={i} className="text-[10px] leading-snug text-[var(--text-muted)]">
              <NodeName s={s} k={`g:${h.from}`} onSelect={onSelect} /> {h.r.stance === 'agree' ? 'agreed' : h.r.stance === 'disagree' ? 'disputed' : 'asked'} in round {h.round}{h.r.point && <>: “{h.r.point}”</>}
            </p>
          ))}</List>}
          <button onClick={() => onAsk(a.id)} className="self-start inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border hover:bg-white/[0.05]" style={{ borderColor: tint(ACCENT, 50), color: ACCENT }}>
            <MessageSquare className="w-3 h-3" /> Ask {a.name.split(' ')[0]}
          </button>
        </>
      );
      break;
    }
    case 'context': {
      const c = sel.item;
      if (c.lat !== null && c.lng !== null) locate = { lat: c.lat, lng: c.lng, zoom: 4 };
      kicker = c.kind === 'quake' ? 'Earthquake' : c.kind === 'market' ? 'Markets' : 'Live intelligence';
      title = <span>{c.title}</span>;
      const bears = s.links.filter(l => l.kind === 'evidence' && l.from === sel.key);
      body = (
        <>
          <p className="text-[9px] text-[var(--text-muted)]">{[c.source, c.place, ago(c.published)].filter(Boolean).join(' · ')}</p>
          {bears.length ? <List label="Bears on">{bears.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="flex items-center gap-2 text-left text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <LineGlyph link={l} /> {nodeName(s, l.to)}{l.label && <span className="text-[var(--text-muted)] truncate">: {l.label}</span>}
            </button>
          ))}</List> : <p className="text-[10px] text-[var(--text-muted)]">Read by the panel; not cited against a particular actor.</p>}
        </>
      );
      break;
    }
    case 'scenario': {
      const sc = sel.scenario;
      if (sc.lat !== null && sc.lng !== null) locate = { lat: sc.lat, lng: sc.lng, zoom: 4 };
      kicker = 'Scenario';
      title = <span>{sc.name} <span className="font-mono text-[var(--text-secondary)]">{pct(sc.probability)}</span></span>;
      body = (
        <>
          <p className="text-[11px] leading-snug text-[var(--text-secondary)]">{sc.description}</p>
          {sc.place && <p className="text-[9px] text-[var(--text-muted)]">Plays out in {sc.place}</p>}
        </>
      );
      break;
    }
    case 'signpost': {
      const sp = sel.signpost;
      if (sp.lat !== null && sp.lng !== null) locate = { lat: sp.lat, lng: sp.lng, zoom: 4.5 };
      kicker = 'Signpost';
      title = <span>{sp.text}</span>;
      body = <p className="text-[10px] text-[var(--text-secondary)]">If it happens, the forecast moves <span className="font-mono uppercase">{directionWord(s.frame, sp.means, sp.favors)}</span>{sp.place && <span className="text-[var(--text-muted)]"> · {sp.place}</span>}</p>;
      break;
    }
  }

  const lit = relatedLinks(s, sel.key).size;
  // A new selection comes into view: in a column or the phone drawer it can sit below the fold.
  const bringIntoView = (el: HTMLElement | null) => {
    if (!el || floating || el.dataset.key === sel.key) return;
    el.dataset.key = sel.key;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return (
    <section ref={bringIntoView} className={`rounded-lg border p-3 flex flex-col gap-2 ${floating ? 'shadow-2xl max-h-[42vh] overflow-y-auto styled-scrollbar' : 'bg-black/30'}`}
      style={{ borderColor: tint(ACCENT, 40), ...(floating ? SOLID : {}) }}>
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono tracking-[0.18em] uppercase" style={{ color: ACCENT }}>{kicker}</span>
        {lit > 1 && <span className="text-[9px] text-[var(--text-muted)]">{lit} arcs lit</span>}
        <span className="ml-auto flex items-center gap-1">
          {locate && <IconButton title="Show on the globe" onClick={() => onLocate(locate!.lat, locate!.lng, locate!.zoom)}><LocateFixed className="w-3.5 h-3.5" /></IconButton>}
          <IconButton title="Close" onClick={() => onSelect(null)}><X className="w-3.5 h-3.5" /></IconButton>
        </span>
      </div>
      <h4 className="text-[12px] font-semibold leading-snug text-[var(--text-primary)]">{title}</h4>
      {body}
    </section>
  );
}

function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <span className="text-[8px] font-mono tracking-[0.18em] uppercase text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

/* ───────────────────────────── Footer and history ───────────────────────────── */

function UsageLine({ s }: { s: RunState }) {
  const tokens = s.usage.input + s.usage.output;
  return (
    <div className="px-3 py-2 border-t border-[var(--border-secondary)] text-[9px] font-mono text-[var(--text-muted)] flex flex-wrap gap-x-2">
      <span>{s.provider} / {s.model}</span>
      <span>{s.usage.calls} calls</span>
      {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
      {currentAnswer(s) && <span className="text-[var(--text-secondary)]">· {currentAnswer(s)}</span>}
      {s.warnings.length > 0 && <span title={s.warnings.join('\n')} style={{ color: 'var(--alert-orange)' }}>{s.warnings.length} hiccup{s.warnings.length === 1 ? '' : 's'}</span>}
    </div>
  );
}

function HistoryList({ oai, onPick }: { oai: OaiClient; onPick: (id: string) => void }) {
  if (!oai.history.length) {
    return <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3"><Label>Your forecasts</Label><Empty>Nothing yet. Forecasts you run are listed here, in this browser only. The server keeps a run for a few hours.</Empty></section>;
  }
  return (
    <section className="rounded-md border border-[var(--border-primary)] bg-black/20 p-3">
      <Label>Your forecasts</Label>
      <div className="flex flex-col">
        {oai.history.map(h => (
          <div key={h.id} className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
            <button onClick={() => onPick(h.id)} className="flex-1 min-w-0 text-left group">
              <span className="block text-[10px] text-[var(--text-primary)] group-hover:underline truncate">{h.question}</span>
              <span className="block text-[9px] font-mono text-[var(--text-muted)]">{new Date(h.at).toLocaleString()} · {h.status}</span>
            </button>
            <span className="text-[10px] font-mono tabular-nums text-[var(--text-secondary)] max-w-[120px] truncate">{h.answer ?? pct(h.probability)}</span>
            <button onClick={() => oai.forget(h.id)} className="text-[var(--text-muted)] hover:text-[var(--alert-red)]" aria-label="Remove from history"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
