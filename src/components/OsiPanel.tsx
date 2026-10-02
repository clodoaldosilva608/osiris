'use client';
/**
 * OSIRIS OSI: the panel.
 *
 * Docked, it is a column beside the map: set up an engine with your own key,
 * ask, follow the run, read the report and question the panel. Full screen,
 * it becomes a theatre: the verdict and report on the left, the debate, the
 * panel and the world model on the right, and in the middle either the live
 * globe or the research graph, every actor, panelist and piece of evidence
 * with every link between them. Whatever is selected, from the globe, the
 * graph or a list, opens in the inspector, which shows exactly that piece of
 * the research.
 *
 * It wears the platform's own theme (glass panels, HUD type, the theme's
 * accents through its CSS variables), so it is gold and cyan in Core and turns
 * violet with Ghost. The only colours of its own are the three line colours,
 * which are the arcs' and are set in the Style Studio.
 *
 * The run itself lives in the page (useOsi), so closing this panel leaves the
 * globe drawing.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Camera, Check, ChevronDown, Copy, Crosshair, Download, Eye, EyeOff, Globe2, History,
  KeyRound, Loader2, LocateFixed, Maximize2, MessageSquare, Minimize2, Network, Plus, Send, Square, Trash2, X, Zap,
} from 'lucide-react';
import { PROVIDERS, providerInfo, type ProviderId } from '@/lib/osi/providers';
import { DEPTHS, estimateCalls } from '@/lib/osi/depths';
import { checkKey, forgetKey, loadEngine, loadKey, saveEngine, saveKey, toMarkdown, type Engine, type OsiClient } from '@/lib/osi/client';
import { currentAnswer, latestPosts, type RunState } from '@/lib/osi/state';
import { estimateRange } from '@/lib/osi/globe';
import { directionWord, formatAmount, leader, outcomeColor, positionIn, postView } from '@/lib/osi/forecast';
import { nodeName, postFor, relatedLinks, resolve, type Selection } from '@/lib/osi/research';
import type { ContextItem, Depth, Frame, Link, Post, RoundStat } from '@/lib/osi/types';
import OsiGraph from './OsiGraph';

/* ───────────────────────────── Theme ───────────────────────────── */

/** The platform's theme variables: Core is gold and cyan, Ghost turns them violet. */
const T = {
  gold: 'var(--gold-primary)',
  goldLight: 'var(--gold-light)',
  cyan: 'var(--cyan-primary)',
  heading: 'var(--text-heading)',
  text: 'var(--text-primary)',
  body: 'var(--text-secondary)',
  mute: 'var(--text-muted)',
  line: 'var(--border-secondary)',
  lineStrong: 'var(--border-primary)',
  active: 'var(--border-active)',
  red: 'var(--alert-red)',
  orange: 'var(--alert-orange)',
  green: 'var(--alert-green)',
  /** The arcs' three colours, from the Style Studio. */
  support: 'var(--map-osi-support, #b388ff)',
  oppose: 'var(--map-osi-oppose, #ff5ccb)',
  neutral: 'var(--map-osi-neutral, #8c7cff)',
};
const gold = (a: number) => `rgba(var(--gold-rgb),${a})`;
const cyan = (a: number) => `rgba(var(--cyan-rgb),${a})`;
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const toneColor = (tone: Link['tone']) => (tone === 'support' ? T.support : tone === 'oppose' ? T.oppose : T.neutral);
/** Toward YES (or higher) in gold, toward NO (or lower) in cyan; a choice in its outcome's colour. */
const leanTo = (frame: Frame | null, push: 'yes' | 'no', favors = '') =>
  frame?.kind === 'choice' && favors ? outcomeColor(Math.max(0, frame.outcomes.indexOf(favors))) : push === 'yes' ? T.gold : T.cyan;

const LABEL = 'text-[9px] font-mono tracking-[0.18em] uppercase';
const FIELD = 'w-full bg-black/40 border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] transition-colors';

const pct = (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`);
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const shortName = (name: string) => name.replace(' (Alibaba Cloud)', '').replace(' (scripted, dev only)', '');

const EXAMPLES: { kind: Frame['kind']; text: string }[] = [
  { kind: 'binary', text: 'Will Russia and Ukraine agree a ceasefire before 1 July 2027?' },
  { kind: 'choice', text: 'Which way will the US Federal Reserve move rates at its next meeting: cut, hold or hike?' },
  { kind: 'number', text: 'Where will Brent crude settle on 31 December 2026, in USD a barrel?' },
];

const KIND_LABEL: Record<Frame['kind'], string> = { binary: 'Yes / no', choice: 'Which outcome', number: 'How much' };
const KIND_SHORT: Record<Frame['kind'], string> = { binary: 'Yes / no', choice: 'Which', number: 'How much' };

const PHASES: { id: RunState['phase']; label: string }[] = [
  { id: 'context', label: 'Feeds' },
  { id: 'graph', label: 'World' },
  { id: 'agents', label: 'Panel' },
  { id: 'simulate', label: 'Debate' },
  { id: 'report', label: 'Report' },
];

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** A number that eases to its new value instead of jumping: up from zero the first time, then from wherever it is. */
function useTween(target: number | null, ms = 900): number | null {
  const [shown, setShown] = useState<number | null>(null);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (target === null || !Number.isFinite(target)) return;
    const start = from.current ?? 0;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = start + (target - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return target === null ? null : shown ?? 0;
}

/* ───────────────────────────── The mark ───────────────────────────── */

/** OSI's mark in the theme's colours: a core, its ring, and a body in orbit that turns while a run is live. */
export function OsiMark({ size = 16, live = false }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="flex-shrink-0">
      <circle cx="12" cy="12" r="8.5" style={{ stroke: T.gold }} strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" style={{ fill: T.gold }} />
      <g style={{ transformOrigin: '12px 12px', animation: live ? 'spin 3.2s linear infinite' : undefined }}>
        <circle cx="12" cy="3.5" r="2.1" style={{ fill: T.cyan }} />
      </g>
    </svg>
  );
}

/* ───────────────────────────── The panel ───────────────────────────── */

export interface OsiPanelProps {
  osi: OsiClient;
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
type Stage = 'globe' | 'graph';

export default function OsiPanel(props: OsiPanelProps) {
  const { osi, selected, onSelect, embedded = false, theater = false } = props;
  // Settings come from this browser's storage. The panel only renders once opened, on the client.
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [key, setKey] = useState(() => loadKey(initialEngine().provider));
  const [engineOpen, setEngineOpen] = useState(() => {
    const e = initialEngine();
    return providerInfo(e.provider).needsKey && !loadKey(e.provider);
  });
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [askTarget, setAskTarget] = useState('report');
  const [stage, setStage] = useState<Stage>('globe');

  const s = osi.state;
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
  const reset = () => { osi.clear(); onSelect(null); setShowHistory(false); setTab(null); };

  const errorBox = osi.error ? (
    <div className="mx-4 mt-3 rounded-md px-3 py-2 text-[11px] leading-snug flex items-start gap-2 border" style={{ color: T.text, background: 'rgba(255,61,61,0.07)', borderColor: 'rgba(255,61,61,0.3)' }}>
      <span className="flex-1">{osi.error}</span>
      <button onClick={() => osi.setError('')} className="text-[var(--text-muted)] hover:text-white" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
    </div>
  ) : null;

  const tabs = s ? (
    <RunTabs
      s={s} tab={activeTab} setTab={setTab} osi={osi} engine={engine} keyValue={key} ready={ready}
      selected={selected} onSelect={onSelect} askTarget={askTarget} setAskTarget={setAskTarget} theater={theater}
    />
  ) : null;

  /* ── Full screen: a theatre around the globe or the graph ── */
  if (theater && s && !embedded) {
    const node = (
      <div className="fixed inset-0 z-[900] pointer-events-none">
        <div className="absolute inset-x-0 top-0 h-[96px]" style={{ background: 'linear-gradient(to bottom, rgba(4,4,10,0.9) 45%, transparent)' }} />
        <div className="absolute inset-x-0 bottom-0 h-[60px]" style={{ background: 'linear-gradient(to top, rgba(4,4,10,0.8) 40%, transparent)' }} />
        <TheaterTopBar s={s} stage={stage} setStage={setStage} {...props} />
        <aside className="glass-panel absolute left-4 top-[84px] bottom-4 w-[392px] pointer-events-auto flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
            {errorBox}
            <div className="p-5 flex flex-col gap-6">
              <Verdict key={osi.runId ?? ''} s={s} large />
              {s.status === 'running' && osi.canSteer && <InjectBox osi={osi} s={s} />}
              {s.report ? <ReportBody s={s} runId={osi.runId} selected={selected} onSelect={onSelect} /> : <ContextList s={s} selected={selected} onSelect={onSelect} />}
            </div>
          </div>
          <UsageLine s={s} />
        </aside>
        <aside className="glass-panel absolute right-4 top-[84px] bottom-4 w-[420px] pointer-events-auto flex flex-col overflow-hidden">
          {tabs}
        </aside>
        <AnimatePresence>
          {stage === 'graph' && (
            <motion.div key="graph" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.25 }}
              className="glass-panel absolute left-[424px] right-[452px] top-[84px] bottom-4 pointer-events-auto overflow-hidden">
              <OsiGraph s={s} selected={selected} onSelect={onSelect} bottomInset={Math.round(window.innerHeight * 0.44) + 40} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute bottom-7 left-[440px] right-[468px] flex justify-center pointer-events-none">
          <AnimatePresence mode="wait">
            {selection ? (
              <motion.div key={selection.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22 }}
                className="pointer-events-auto w-full max-w-[580px]">
                <Inspector s={s} sel={selection} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent} floating />
              </motion.div>
            ) : stage === 'globe' ? (
              <motion.div key="legend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-auto">
                <Legend floating />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    );
    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
  }

  /* ── Docked, or in the phone drawer ── */
  const header = (
    <header className={`flex items-center gap-2 ${embedded ? 'pb-3' : 'px-4 py-3 border-b border-[var(--border-secondary)]'}`}>
      {embedded ? <span className={`${LABEL} text-[var(--text-muted)] truncate`}>Swarm forecasting</span> : (
        <>
          <OsiMark live={s?.status === 'running'} />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">OSI</span>
          {!s && <span className={`${LABEL} text-[var(--text-muted)] truncate`}>Swarm forecasting</span>}
          {s?.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[var(--alert-green)] animate-osiris-pulse" title="Running" />}
        </>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <EnginePill engine={engine} ready={ready} open={engineOpen} onClick={() => setEngineOpen(v => !v)} />
        <IconButton title={showHistory ? 'Back' : 'Your forecasts'} onClick={() => setShowHistory(v => !v)} active={showHistory}><History className="w-3.5 h-3.5" /></IconButton>
        {s && <IconButton title="New forecast" onClick={reset}><Plus className="w-3.5 h-3.5" /></IconButton>}
        {!embedded && s && props.onTheater && <IconButton title="Full screen: the globe or the research graph" onClick={() => props.onTheater?.(true)}><Maximize2 className="w-3.5 h-3.5" /></IconButton>}
        {props.onClose && !embedded && <IconButton title="Close (the run keeps going)" onClick={props.onClose}><X className="w-3.5 h-3.5" /></IconButton>}
      </div>
    </header>
  );

  const body = (
    <>
      <AnimatePresence initial={false}>
        {engineOpen && (
          <motion.div key="engine" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <EngineSheet engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey} onDone={() => setEngineOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {errorBox}
      {showHistory ? (
        <HistoryList osi={osi} onPick={id => { setShowHistory(false); setTab(null); onSelect(null); void osi.watch(id); }} />
      ) : !s ? (
        <AskForm ready={ready} providerName={info.name} onKey={() => setEngineOpen(true)} onRun={async (input) => {
          const id = await osi.start(input, engine, key);
          if (id) { setShowHistory(false); setTab(null); onSelect(null); }
          return Boolean(id);
        }} />
      ) : (
        <div className="flex flex-col">
          <div className="px-4 pt-4 pb-5 flex flex-col gap-5 border-b border-[var(--border-secondary)]">
            <RunHead s={s} osi={osi} focus={props.focus} onFocus={props.onFocus} following={props.following} onFollow={props.onFollow} />
            <Verdict key={osi.runId ?? ''} s={s} />
          </div>
          <AnimatePresence mode="wait">
            {selection && (
              <motion.div key={selection.key} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="px-4 pt-4">
                <Inspector s={s} sel={selection} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent} />
              </motion.div>
            )}
          </AnimatePresence>
          {s.status === 'running' && osi.canSteer && <div className="px-4 pt-4"><InjectBox osi={osi} s={s} /></div>}
          <div className="pt-2">{tabs}</div>
          <UsageLine s={s} />
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex flex-col">{header}<div className="-mx-3">{body}</div></div>;

  return (
    <div className="glass-panel overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      {header}
      <div className="min-h-0 overflow-y-auto styled-scrollbar">{body}</div>
    </div>
  );
}

/* ───────────────────────────── Atoms ───────────────────────────── */

function IconButton({ children, title, onClick, active }: { children: ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--hover-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${active ? 'text-[var(--gold-light)] bg-[var(--hover-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

function SectionTitle({ children, count, right }: { children: ReactNode; count?: number; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className={`${LABEL} text-[var(--text-secondary)]`}>{children}</span>
      {count !== undefined && <span className="text-[9px] font-mono tabular-nums text-[var(--cyan-primary)]">{count}</span>}
      <span className="flex-1 h-px bg-[var(--border-secondary)]" />
      {right}
    </div>
  );
}

function Overline({ children, color }: { children: ReactNode; color?: string }) {
  return <span className={LABEL} style={{ color: color ?? T.mute }}>{children}</span>;
}

function TextButton({ children, onClick, title, tone, active }: { children: ReactNode; onClick: () => void; title?: string; tone?: 'danger'; active?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[9px] font-mono tracking-[0.16em] uppercase transition-colors hover:bg-[var(--hover-accent)] ${tone === 'danger' ? 'text-[var(--text-muted)] hover:text-[var(--alert-red)]' : active ? 'text-[var(--gold-light)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

/** The platform's toggle switch. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`layer-toggle ${on ? 'active' : ''}`} />;
}

/** Choices in a row with a sliding highlight, the same control as the map's 3D / 2D switch. */
function Segmented<T extends string>({ id, options, value, onChange }: { id: string; options: { value: T; label: string; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-[3px] p-[3px] rounded-lg border border-[var(--border-secondary)] bg-black/40">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={on}
            className={`relative flex-1 flex items-center justify-center gap-1.5 h-7 px-3 rounded-md text-[9.5px] font-mono font-medium tracking-[0.18em] uppercase transition-colors duration-200 ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {on && (
              <motion.span layoutId={`osi-seg-${id}`} transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-md border border-[var(--border-active)] bg-[var(--gold-primary)]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_14px_var(--gold-glow)]" />
            )}
            {o.icon && <span className="relative z-10">{o.icon}</span>}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Engine ───────────────────────────── */

function EnginePill({ engine, ready, open, onClick }: { engine: Engine; ready: boolean; open: boolean; onClick: () => void }) {
  const info = providerInfo(engine.provider);
  return (
    <button onClick={onClick} title="Model engine and key"
      className={`mr-1 inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md border text-[9px] font-mono tracking-[0.14em] uppercase transition-colors max-w-[140px] hover:bg-[var(--hover-accent)] ${open ? 'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)]'}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ready ? T.green : T.orange, boxShadow: `0 0 6px ${ready ? T.green : T.orange}` }} />
      <span className="truncate">{ready ? shortName(info.name) : 'Add key'}</span>
      <ChevronDown className="w-3 h-3 flex-shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
  );
}

function EngineSheet({ engine, setEngine, keyValue, setKey, onDone }: {
  engine: Engine; setEngine: (e: Engine) => void; keyValue: string; setKey: (k: string) => void; onDone: () => void;
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

  return (
    <section className="px-4 py-4 border-b border-[var(--border-secondary)] flex flex-col gap-4" style={{ background: gold(0.025) }}>
      <div>
        <SectionTitle right={ready ? <TextButton onClick={onDone}>Done</TextButton> : undefined}>Engine · your own key</SectionTitle>
        <div className="grid grid-cols-3 gap-1">
          {PROVIDERS.map(p => {
            const on = engine.provider === p.id;
            return (
              <button key={p.id} onClick={() => pickProvider(p.id)} title={p.name}
                className={`h-8 px-1.5 rounded-md border text-[9px] font-mono tracking-[0.1em] uppercase truncate transition-colors ${on ? 'border-[var(--border-active)] bg-[var(--gold-primary)]/10 text-[var(--gold-light)]' : 'border-[var(--border-secondary)] bg-white/[0.02] text-[var(--text-secondary)] hover:bg-[var(--hover-accent)] hover:text-[var(--text-primary)]'}`}>
                {shortName(p.name)}
              </button>
            );
          })}
        </div>
      </div>

      {info.needsKey ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <KeyRound className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type={reveal ? 'text' : 'password'} value={keyValue} onChange={e => { setKey(e.target.value.trim()); setStatus({ kind: 'idle', text: '' }); }}
                placeholder={`${info.name} key  ${info.keyHint}`} autoComplete="off" spellCheck={false}
                data-1p-ignore data-lpignore="true" aria-label={`${info.name} API key`}
                className={`${FIELD} h-8 pl-7 pr-8 text-[11px] font-mono`}
              />
              <button onClick={() => setReveal(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white" aria-label={reveal ? 'Hide key' : 'Show key'}>
                {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <button onClick={check} disabled={!keyValue || status.kind === 'checking'} className="btn-tactical h-8 disabled:opacity-40 disabled:pointer-events-none" style={{ padding: '0 14px', fontSize: 10 }}>
              {status.kind === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}
            </button>
          </div>
          {status.text && (
            <p className="text-[10.5px] flex items-center gap-1.5" style={{ color: status.kind === 'error' ? T.red : T.green }}>
              {status.kind === 'ok' && <Check className="w-3 h-3" />}{status.text}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10.5px]">
            <label className="flex items-center gap-2 cursor-pointer text-[var(--text-secondary)]">
              <Switch on={engine.remember} label="Remember the key on this device" onChange={on => {
                const next = { ...engine, remember: on };
                setEngine(next); saveEngine(next); saveKey(engine.provider, keyValue, on);
              }} />
              Remember on this device
            </label>
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[var(--text-muted)] hover:text-[var(--gold-light)]">Get a key ↗</a>
            {keyValue && <button onClick={() => { forgetKey(engine.provider); setKey(''); setModels(null); setStatus({ kind: 'idle', text: '' }); }} className="text-[var(--text-muted)] hover:text-[var(--alert-red)]">Forget</button>}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">Scripted answers for trying the pipeline on a development server. No key, no cost, no real analysis.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Overline>Model</Overline>
          {(models?.length ?? 0) > 12 && (
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter models" className={`${FIELD} ml-auto !w-32 h-6 px-2 text-[10px]`} />
          )}
        </div>
        <select value={engine.model} onChange={e => { const next = { ...engine, model: e.target.value }; setEngine(next); saveEngine(next); }} aria-label="Model"
          className={`${FIELD} h-8 px-2 text-[11px] font-mono`}>
          {shown.map(m => <option key={m.id} value={m.id} style={{ background: '#0C0E1A' }}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
        </select>
        {!models && info.needsKey && <p className="text-[10px] text-[var(--text-muted)]">Check the key to list every model it can use.</p>}
      </div>

      {info.needsKey && (
        <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
          Your key stays in this browser{engine.remember ? '' : ' tab'} and reaches OSIRIS only inside your requests, which pass it to {info.name} for your run. It is never stored on the server or logged. A forecast makes about 15 to 70 model calls, billed to your {info.name} account.
        </p>
      )}
    </section>
  );
}

/* ───────────────────────────── Asking ───────────────────────────── */

function AskForm({ ready, providerName, onRun, onKey }: { ready: boolean; providerName: string; onKey: () => void; onRun: (input: { question: string; seed: string; depth: Depth; useFeeds: boolean }) => Promise<boolean> }) {
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
  const d = DEPTHS[depth];
  return (
    <section className="px-4 pt-4 pb-4 flex flex-col gap-4">
      <div>
        <h3 className="text-[13px] font-semibold tracking-wide text-[var(--text-heading)]">Ask the panel</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          A simulated panel of forecasters debates your question in rounds, grounded in live OSIRIS intelligence, while the analysis draws itself on the globe.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={question} onChange={e => setQuestion(e.target.value.slice(0, 500))} rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run(); }}
          placeholder="What do you want to know?" aria-label="Your question"
          className={`${FIELD} rounded-lg resize-none px-3 py-2.5 text-[12.5px] leading-relaxed`}
        />
        {!question && (
          <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
            {EXAMPLES.map(x => (
              <button key={x.text} onClick={() => setQuestion(x.text)} className="group flex items-center gap-2.5 py-1.5 text-left">
                <span className={`w-[58px] flex-shrink-0 ${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>{KIND_SHORT[x.kind]}</span>
                <span className="flex-1 text-[11px] leading-snug truncate text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]">{x.text}</span>
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--gold-primary)]" />
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setShowSeed(!showSeed)} className="self-start flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronDown className="w-3 h-3 transition-transform" style={{ transform: showSeed ? 'rotate(180deg)' : undefined }} />
          Add your own material{seed && ` · ${seed.length.toLocaleString()} characters`}
        </button>
        <AnimatePresence initial={false}>
          {showSeed && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <textarea value={seed} onChange={e => setSeed(e.target.value.slice(0, 20_000))} rows={5} aria-label="Your material"
                placeholder="Paste a report, notes or a draft. The panel reads it alongside the live feeds."
                className={`${FIELD} rounded-lg resize-y px-3 py-2.5 text-[11px] leading-relaxed`} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Overline>Depth</Overline>
          <span className="text-[9px] font-mono tracking-[0.1em] text-[var(--text-muted)]">{d.agents} FORECASTERS · {d.rounds} ROUNDS · ~{estimateCalls(depth)} CALLS</span>
        </div>
        <Segmented id="depth" value={depth} onChange={setDepth} options={(Object.keys(DEPTHS) as Depth[]).map(k => ({ value: k, label: DEPTHS[k].label }))} />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-[var(--border-secondary)] bg-white/[0.015] px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--text-primary)]">Live intelligence</p>
          <p className="text-[10px] text-[var(--text-muted)] truncate">Ground the panel in OSIRIS news, quakes and markets</p>
        </div>
        <Switch on={useFeeds} onChange={setUseFeeds} label="Ground it in the live OSIRIS feeds" />
      </div>

      {ready ? (
        <button onClick={run} disabled={!valid || starting} className="btn-tactical w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none" style={{ color: 'var(--gold-light)' }}>
          {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <OsiMark size={14} />}
          Run forecast
        </button>
      ) : (
        <button onClick={onKey} className="btn-tactical btn-tactical--cyan w-full">Add your {shortName(providerName)} key to start</button>
      )}

      <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
        Answers take the shape of the question: a probability, a share for each outcome, or an estimate with a range. Method after{' '}
        <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold-light)]">MiroFish</a>; also on the{' '}
        <a href="/docs#osi" className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold-light)]">API and MCP</a>. A simulation, not a guarantee.
      </p>
    </section>
  );
}

/* ───────────────────────────── The run ───────────────────────────── */

/** The run's five stages as one connected line. */
function PhaseRail({ s, compact = false }: { s: RunState; compact?: boolean }) {
  const at = s.status === 'done' ? PHASES.length : PHASES.findIndex(p => p.id === s.phase);
  const inset = compact ? 4 : 16;
  return (
    <div className={`relative ${compact ? 'w-[330px]' : 'w-full px-3'}`}>
      <div className="absolute top-[3px] h-px bg-[var(--border-primary)]" style={{ left: inset, right: inset }} />
      <div className="absolute top-[3px] h-px transition-[width] duration-700"
        style={{ left: inset, width: `calc((100% - ${inset * 2}px) * ${Math.min(at, PHASES.length - 1) / (PHASES.length - 1)})`, background: T.gold, boxShadow: `0 0 8px ${gold(0.6)}` }} />
      <div className="relative flex justify-between">
        {PHASES.map((p, i) => {
          const done = i < at;
          const now = i === at && s.status === 'running';
          return (
            <div key={p.id} className="flex flex-col items-center gap-1.5" style={{ width: 0 }}>
              <span className="relative w-[7px] h-[7px] rounded-full" style={{ background: done || now ? T.gold : 'var(--bg-secondary)', boxShadow: `0 0 0 1px ${done || now ? T.gold : 'var(--border-primary)'}` }}>
                {now && <span className="absolute inset-[-4px] rounded-full animate-ping" style={{ background: gold(0.35) }} />}
              </span>
              <span className="text-[8.5px] font-mono tracking-[0.14em] uppercase whitespace-nowrap" style={{ color: now ? T.goldLight : done ? T.body : T.mute }}>{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusLine({ s }: { s: RunState }) {
  if (s.status === 'running') {
    const thinking = Object.keys(s.thinking).length;
    return (
      <p className="flex items-center gap-2 text-[11px] min-w-0 text-[var(--text-secondary)]">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[var(--alert-green)] animate-osiris-pulse" />
        <span className="truncate min-w-0">{s.phaseLabel || 'Starting'}</span>
        {thinking > 0 && <span className="whitespace-nowrap font-mono text-[9.5px] tracking-[0.1em] text-[var(--cyan-primary)]">{thinking} THINKING</span>}
      </p>
    );
  }
  if (s.status === 'failed') return <p className="text-[11px] text-[var(--alert-red)]">{s.message || 'The run failed.'}</p>;
  if (s.status === 'cancelled') return <p className="text-[11px] text-[var(--text-muted)]">Stopped.</p>;
  return <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"><Check className="w-3.5 h-3.5 text-[var(--alert-green)]" /> Forecast complete</p>;
}

function Controls({ s, osi, focus, onFocus, following, onFollow }: { s: RunState; osi: OsiClient; focus?: boolean; onFocus?: () => void; following?: boolean; onFollow?: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {following !== undefined && onFollow && (following
        ? <span title="The camera follows the run. Move the map to take over." className={`inline-flex items-center gap-1.5 h-7 px-2 cursor-default ${LABEL} !text-[9px] text-[var(--cyan-primary)]`}><Camera className="w-3 h-3" /> Following</span>
        : <TextButton onClick={onFollow} title="Let the camera follow the run again"><Camera className="w-3 h-3" /> Follow camera</TextButton>)}
      {onFocus && (
        <TextButton onClick={onFocus} active={focus} title={focus ? 'Bring the other map layers back' : 'Hide the other map layers so the analysis stands out'}>
          <Crosshair className="w-3 h-3" /> {focus ? 'Focused' : 'Focus'}
        </TextButton>
      )}
      {s.status === 'running' && osi.canSteer && <TextButton tone="danger" onClick={() => osi.cancel()}><Square className="w-2.5 h-2.5" /> Stop</TextButton>}
    </div>
  );
}

function RunHead({ s, osi, focus, onFocus, following, onFollow }: { s: RunState; osi: OsiClient; focus?: boolean; onFocus?: () => void; following?: boolean; onFollow?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-start gap-3">
          <h3 className="flex-1 text-[13px] font-semibold leading-snug text-[var(--text-heading)]">{s.question}</h3>
          {s.frame && <span className="gotham-tag gotham-tag--info whitespace-nowrap">{KIND_LABEL[s.frame.kind]}</span>}
        </div>
        {s.frame && s.frame.proposition !== s.question && (
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">{s.frame.kind === 'binary' ? 'Resolves YES if ' : 'Framed as '}</span>{s.frame.proposition}
            {s.frame.horizon && <span className="text-[var(--text-muted)]"> · by {s.frame.horizon}</span>}
          </p>
        )}
      </div>
      <PhaseRail s={s} />
      <div className="flex flex-col gap-1">
        <StatusLine s={s} />
        <div className="-ml-2"><Controls s={s} osi={osi} focus={focus} onFocus={onFocus} following={following} onFollow={onFollow} /></div>
      </div>
    </div>
  );
}

function TheaterTopBar({ s, osi, onTheater, focus, onFocus, following, onFollow, stage, setStage }: OsiPanelProps & { s: RunState; stage: Stage; setStage: (v: Stage) => void }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?osi=${osi.runId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <header className="glass-panel absolute left-4 right-4 top-4 h-[60px] pointer-events-auto flex items-center gap-4 px-4">
      <div className="flex items-center gap-2 flex-shrink-0">
        <OsiMark size={18} live={s.status === 'running'} />
        <span className="hud-text text-[12px] text-[var(--text-primary)]">OSI</span>
      </div>
      <span className="w-px h-7 bg-[var(--border-secondary)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold truncate text-[var(--text-heading)]">{s.question}</p>
        <div className="mt-0.5"><StatusLine s={s} /></div>
      </div>
      {s.frame && <span className="gotham-tag gotham-tag--info whitespace-nowrap">{KIND_LABEL[s.frame.kind]}</span>}
      <PhaseRail s={s} compact />
      <span className="w-px h-7 bg-[var(--border-secondary)]" />
      <div className="w-[200px] flex-shrink-0">
        <Segmented id="stage" value={stage} onChange={setStage} options={[
          { value: 'globe', label: 'Globe', icon: <Globe2 className="w-3 h-3" /> },
          { value: 'graph', label: 'Graph', icon: <Network className="w-3 h-3" /> },
        ]} />
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Controls s={s} osi={osi} focus={focus} onFocus={onFocus} following={following} onFollow={onFollow} />
        <TextButton onClick={share} title="Copy a link that replays this run">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Link</TextButton>
        <IconButton title="Leave full screen (Esc)" onClick={() => onTheater?.(false)}><Minimize2 className="w-3.5 h-3.5" /></IconButton>
      </div>
    </header>
  );
}

/* ───────────────────────────── The verdict ───────────────────────────── */

function Verdict({ s, large = false }: { s: RunState; large?: boolean }) {
  const frame = s.frame;
  const last = s.rounds[s.rounds.length - 1] ?? null;
  const final = Boolean(s.report);
  const caption = final ? 'Forecast' : last ? `Panel · round ${last.round} of ${s.roundsPlanned}` : s.status === 'running' ? 'Forming' : 'Forecast';

  let value: number | null = null;
  let format = (v: number) => `${Math.round(v * 100)}`;
  let suffix = '%';
  let sub = '';
  let detail: ReactNode = null;

  if (frame?.kind === 'choice') {
    const shares = s.report?.shares ?? last?.shares ?? null;
    const lead = shares ? leader(shares) : -1;
    if (shares) { value = shares[lead]; sub = frame.outcomes[lead] ?? ''; }
    detail = (
      <div className="flex flex-col gap-2">
        {frame.outcomes.map((o, i) => {
          const v = shares?.[i] ?? null;
          const top = i === lead;
          return (
            <div key={o}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(i) }} />
                <span className="flex-1 text-[11px] truncate" style={{ color: top ? T.heading : T.body }}>{o}</span>
                <span className="text-[11px] font-mono tabular-nums" style={{ color: top ? T.goldLight : T.body }}>{pct(v)}</span>
              </div>
              <div className="relative h-[3px] rounded-full overflow-hidden bg-white/[0.06]">
                <motion.div className="absolute inset-y-0 left-0 rounded-full" initial={false} animate={{ width: `${(v ?? 0) * 100}%` }} transition={{ duration: 0.7, ease: 'easeOut' }}
                  style={{ background: top ? T.gold : 'rgba(255,255,255,0.22)', boxShadow: top ? `0 0 8px ${gold(0.6)}` : undefined }} />
                {frame.prior[i] !== undefined && <span className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${frame.prior[i] * 100}%` }} title={`Prior ${pct(frame.prior[i])}`} />}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (frame?.kind === 'number') {
    const e = s.report?.estimate ?? (last?.value ? { value: last.value.median, low: last.value.low, high: last.value.high } : null);
    if (e) { value = e.value; format = formatAmount; suffix = ''; sub = frame.unit; }
    if (e) {
      const lo = Math.min(e.low, frame.anchor ?? e.low, last?.value?.min ?? e.low);
      const hi = Math.max(e.high, frame.anchor ?? e.high, last?.value?.max ?? e.high);
      const at = (v: number) => positionIn(v, lo, hi) * 100;
      detail = (
        <div>
          <div className="relative h-5">
            <span className="absolute top-[9px] inset-x-0 h-[2px] rounded-full bg-white/[0.07]" />
            <motion.span className="absolute top-[7px] h-[6px] rounded-sm" initial={false} animate={{ left: `${at(e.low)}%`, width: `${at(e.high) - at(e.low)}%` }} transition={{ duration: 0.7 }}
              style={{ background: gold(0.22), boxShadow: `inset 0 0 0 1px ${gold(0.45)}` }} />
            <motion.span className="absolute top-[3px] w-[2px] h-[14px] -ml-px rounded-full" initial={false} animate={{ left: `${at(e.value)}%` }} transition={{ duration: 0.7 }}
              style={{ background: T.goldLight, boxShadow: `0 0 10px ${gold(0.8)}` }} />
            {frame.anchor !== null && (
              <span className="absolute top-[5px] w-px h-[10px] bg-[var(--cyan-primary)]" style={{ left: `${at(frame.anchor)}%` }} title={`Today: ${formatAmount(frame.anchor)}`} />
            )}
          </div>
          <div className="flex justify-between text-[9.5px] font-mono tabular-nums text-[var(--text-muted)]">
            <span>{formatAmount(e.low)}</span>
            <span className="tracking-[0.14em]">80% RANGE</span>
            <span>{formatAmount(e.high)}</span>
          </div>
          {frame.anchor !== null && <p className="mt-1.5 text-[9.5px] font-mono tracking-[0.1em] text-[var(--text-muted)]">TODAY <span className="text-[var(--cyan-primary)]">{formatAmount(frame.anchor)}</span></p>}
        </div>
      );
    }
  } else if (frame) {
    const p = s.report?.probability ?? last?.consensus ?? null;
    if (p !== null) { value = p; sub = 'chance of YES'; }
    detail = (
      <div>
        <div className="relative h-5">
          <span className="absolute top-[9px] inset-x-0 h-[2px] rounded-full bg-white/[0.07]" />
          {last && <motion.span className="absolute top-[7px] h-[6px] rounded-sm" initial={false} animate={{ left: `${last.p25 * 100}%`, width: `${Math.max(1, (last.p75 - last.p25) * 100)}%` }} transition={{ duration: 0.7 }}
            style={{ background: gold(0.2), boxShadow: `inset 0 0 0 1px ${gold(0.4)}` }} title="The middle half of the panel" />}
          <span className="absolute top-[5px] w-px h-[10px] bg-[var(--cyan-primary)]" style={{ left: `${frame.baseRate * 100}%` }} title={`Base rate ${pct(frame.baseRate)}`} />
          {p !== null && <motion.span className="absolute top-[2px] w-[2px] h-4 -ml-px rounded-full" initial={false} animate={{ left: `${p * 100}%` }} transition={{ duration: 0.7, ease: 'easeOut' }}
            style={{ background: T.goldLight, boxShadow: `0 0 10px ${gold(0.8)}` }} />}
        </div>
        <div className="flex justify-between text-[9.5px] font-mono tracking-[0.14em] text-[var(--text-muted)]">
          <span>NO</span><span>BASE RATE <span className="text-[var(--cyan-primary)]">{pct(frame.baseRate)}</span></span><span>YES</span>
        </div>
      </div>
    );
  }

  const shown = useTween(value);
  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <Overline>{caption}</Overline>
          <div className={`mt-1 flex items-baseline gap-1 font-mono font-light tabular-nums tracking-[-0.02em] ${large ? 'text-[52px] leading-[0.95]' : 'text-[42px] leading-none'}`}
            style={{ color: T.heading, textShadow: `0 0 22px ${gold(0.25)}` }}>
            {shown === null ? <span className="text-[var(--text-muted)]">—</span> : <>{format(shown)}<span className={`${large ? 'text-[22px]' : 'text-[18px]'} text-[var(--gold-primary)]`}>{suffix}</span></>}
          </div>
          {sub && <p className="mt-1 text-[11.5px] truncate text-[var(--text-secondary)]">{sub}</p>}
        </div>
        <Trajectory s={s} width={large ? 150 : 128} />
      </div>
      {detail}
    </section>
  );
}

/** A window around some values, at least `min` wide, so small moves still read as moves. */
function fit(vals: number[], min: number): [number, number] {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const half = Math.max(min, (hi - lo) * 1.2) / 2;
  return [(lo + hi) / 2 - half, (lo + hi) / 2 + half];
}

/** A smooth line through points, for the trajectories. */
function smooth(points: [number, number][]): string {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[Math.max(0, i - 1)];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[Math.min(points.length - 1, i + 2)];
    d += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return d;
}

function Trajectory({ s, width = 128 }: { s: RunState; width?: number }) {
  const W = width, H = 48;
  const frame = s.frame;
  const gid = `osi-tr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!frame || !s.rounds.length) return <div style={{ width: W, height: H }} />;
  const n = s.rounds.length + (s.report ? 1 : 0);
  const x = (i: number) => (n === 1 ? W / 2 : 4 + (i / (n - 1)) * (W - 8));

  if (frame.kind === 'choice') {
    const series = frame.outcomes.map((_, k) => [...s.rounds.map(r => r.shares?.[k] ?? 0), ...(s.report?.shares ? [s.report.shares[k]] : [])]);
    const top = Math.max(0.1, ...series.flat()) * 1.1;
    const y = (v: number) => H - 4 - (v / top) * (H - 8);
    const lead = leader(series.map(v => v[v.length - 1]));
    return (
      <svg width={W} height={H} className="flex-shrink-0 overflow-visible" aria-hidden>
        {series.map((vals, k) => (
          <path key={k} d={smooth(vals.map((v, i) => [x(i), y(v)]))} fill="none" strokeWidth={k === lead ? 1.8 : 1.2} strokeLinecap="round"
            style={{ stroke: k === lead ? T.gold : outcomeColor(k), opacity: k === lead ? 1 : 0.55 }} />
        ))}
      </svg>
    );
  }

  let vals: number[];
  let y: (v: number) => number;
  let ref: number | null = null;
  if (frame.kind === 'number') {
    const pts = s.rounds.map(r => r.value?.median ?? NaN);
    vals = [...pts, ...(s.report?.estimate ? [s.report.estimate.value] : [])].filter(Number.isFinite);
    const all = [...vals, ...s.rounds.flatMap(r => (r.value ? [r.value.p25, r.value.p75] : [])), ...(frame.anchor !== null ? [frame.anchor] : [])];
    const lo = Math.min(...all), hi = Math.max(...all);
    y = v => (hi > lo ? H - 4 - ((v - lo) / (hi - lo)) * (H - 8) : H / 2);
    ref = frame.anchor;
  } else {
    vals = [...s.rounds.map(r => r.consensus), ...(s.report ? [s.report.probability] : [])];
    const [lo, hi] = fit([...vals, ...s.rounds.flatMap(r => [r.p25, r.p75]), frame.baseRate], 0.2);
    y = v => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
    ref = frame.baseRate;
  }
  const pts = vals.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = smooth(pts);
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z` : '';
  const end = pts[pts.length - 1];
  return (
    <svg width={W} height={H} className="flex-shrink-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: T.gold, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: T.gold, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {ref !== null && <line x1={0} x2={W} y1={y(ref)} y2={y(ref)} strokeDasharray="2 4" style={{ stroke: T.cyan, opacity: 0.45 }} />}
      {area && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" strokeWidth={1.6} strokeLinecap="round" style={{ stroke: T.gold }} />
      {end && <circle cx={end[0]} cy={end[1]} r={3} strokeWidth={1.5} style={{ fill: s.report ? T.goldLight : T.gold, stroke: 'var(--bg-void)' }} />}
    </svg>
  );
}

/* ───────────────────────────── Steering ───────────────────────────── */

function InjectBox({ osi, s }: { osi: OsiClient; s: RunState }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const late = s.phase === 'report';
  const send = async () => {
    if (text.trim().length < 3) return;
    const err = await osi.inject(text.trim());
    setMsg(err ?? 'Queued. The panel takes it up at the start of the next round.');
    if (!err) setText('');
    setTimeout(() => setMsg(''), 3500);
  };
  return (
    <div>
      <div className="flex items-center gap-2 h-9 pl-2.5 pr-1 rounded-md border border-[var(--border-primary)] bg-black/40 focus-within:border-[var(--border-active)] transition-colors">
        <Zap className="w-3.5 h-3.5 flex-shrink-0 text-[var(--alert-orange)]" />
        <input value={text} onChange={e => setText(e.target.value.slice(0, 400))} onKeyDown={e => e.key === 'Enter' && send()} disabled={late}
          placeholder={late ? 'The report is being written' : 'Inject an event into the simulation'} aria-label="Event to inject"
          className="flex-1 bg-transparent outline-none text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50" />
        <button onClick={send} disabled={late || text.trim().length < 3}
          className="h-7 px-2.5 rounded text-[9px] font-mono tracking-[0.16em] text-[var(--alert-orange)] hover:bg-[rgba(255,149,0,0.1)] disabled:opacity-30 transition-colors">
          INJECT
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[10.5px] text-[var(--text-secondary)]">{msg}</p>}
    </div>
  );
}

/* ───────────────────────────── The report ───────────────────────────── */

function ReportBody({ s, runId, selected, onSelect }: { s: RunState; runId: string | null; selected: string | null; onSelect: (k: string | null) => void }) {
  const r = s.report!;
  const frame = s.frame;
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' && runId ? `${window.location.origin}/?osi=${runId}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const blob = new Blob([toMarkdown(s, url)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `osiris-osi-${(runId ?? 'forecast').slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const conf = { low: 'gotham-tag--high', medium: 'gotham-tag--medium', high: 'gotham-tag--low' }[r.confidence];

  return (
    <section className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Overline color={T.gold}>Report</Overline>
          <div className="ml-auto flex items-center -mr-2">
            <TextButton onClick={copy}>{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Link</TextButton>
            <TextButton onClick={download}><Download className="w-3 h-3" /> Export</TextButton>
          </div>
        </div>
        <h3 className="text-[14px] font-semibold leading-snug text-[var(--text-heading)]">{r.headline}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`gotham-tag ${conf}`}>{r.confidence} confidence</span>
          {frame?.kind === 'binary' && <span className="text-[9.5px] font-mono tracking-[0.1em] text-[var(--text-muted)]">PANEL {pct(r.swarm)} · REPORT {pct(r.probability)}</span>}
        </div>
        {r.deviation && <p className="mt-2 text-[11px] italic leading-relaxed text-[var(--text-muted)]">{r.deviation}</p>}
        <p className="mt-2.5 text-[11.5px] leading-[1.65] text-[var(--text-secondary)]">{r.summary}</p>
      </div>

      {r.drivers.length > 0 && (
        <div>
          <SectionTitle count={r.drivers.length}>Drivers</SectionTitle>
          <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
            {r.drivers.map((d, i) => {
              const color = leanTo(frame, d.push, d.favors);
              const actorKey = d.actor ? `a:${d.actor}` : null;
              return (
                <button key={i} disabled={!actorKey} onClick={() => actorKey && onSelect(actorKey === selected ? null : actorKey)}
                  className="group flex items-start gap-2.5 py-2 text-left disabled:cursor-default">
                  {d.push === 'yes' ? <ArrowUpRight className="w-3.5 h-3.5 mt-px flex-shrink-0" style={{ color }} /> : <ArrowDownRight className="w-3.5 h-3.5 mt-px flex-shrink-0" style={{ color }} />}
                  <span className="flex-1 text-[11.5px] leading-snug text-[var(--text-secondary)] transition-colors group-enabled:group-hover:text-[var(--text-primary)]">{d.text}</span>
                  <span className="mt-px text-[9px] font-mono tracking-[0.12em] uppercase whitespace-nowrap" style={{ color }}>{directionWord(frame, d.push, d.favors)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.scenarios.length > 0 && (
        <div>
          <SectionTitle count={r.scenarios.length}>Scenarios</SectionTitle>
          <div className="flex flex-col gap-2.5">
            {r.scenarios.map((sc, i) => {
              const key = `s:${i}`;
              const on = selected === key;
              return (
                <button key={i} onClick={() => onSelect(on ? null : key)} className="group text-left">
                  <div className="flex items-baseline gap-2">
                    <span className={`flex-1 text-[11.5px] truncate transition-colors group-hover:text-[var(--text-primary)] ${on ? 'text-[var(--text-heading)]' : 'text-[var(--text-secondary)]'}`}>{sc.name}</span>
                    <span className="text-[11px] font-mono tabular-nums text-[var(--gold-light)]">{pct(sc.probability)}</span>
                  </div>
                  <div className="mt-1 h-[3px] rounded-full overflow-hidden bg-white/[0.06]">
                    <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${sc.probability * 100}%` }} transition={{ duration: 0.8, delay: i * 0.08 }}
                      style={{ background: on ? T.goldLight : `linear-gradient(90deg, var(--gold-dim), ${T.gold})` }} />
                  </div>
                  <p className="mt-1 text-[10.5px] leading-snug text-[var(--text-muted)]">{sc.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.signposts.length > 0 && (
        <div>
          <SectionTitle count={r.signposts.length}>Signposts to watch</SectionTitle>
          <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
            {r.signposts.map((sp, i) => {
              const key = `p:${i}`;
              const color = leanTo(frame, sp.means, sp.favors);
              return (
                <button key={i} onClick={() => onSelect(selected === key ? null : key)} className="group flex items-start gap-2.5 py-2 text-left">
                  <span className="mt-[5px] w-1.5 h-1.5 rotate-45 flex-shrink-0" style={{ background: color }} />
                  <span className={`flex-1 text-[11.5px] leading-snug transition-colors group-hover:text-[var(--text-primary)] ${selected === key ? 'text-[var(--text-heading)]' : 'text-[var(--text-secondary)]'}`}>
                    {sp.text}{sp.place && <span className="text-[var(--text-muted)]"> · {sp.place}</span>}
                  </span>
                  <span className="mt-px text-[9px] font-mono tracking-[0.12em] uppercase whitespace-nowrap" style={{ color }}>→ {directionWord(frame, sp.means, sp.favors)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {r.dissent && (
        <blockquote className="pl-3 py-0.5 border-l-2 border-[var(--cyan-primary)]">
          <Overline color={T.cyan}>Dissent</Overline>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{r.dissent}</p>
        </blockquote>
      )}
      {r.caveats.length > 0 && (
        <ul className="flex flex-col gap-1">
          {r.caveats.map((c, i) => <li key={i} className="text-[10.5px] leading-snug text-[var(--text-muted)]">· {c}</li>)}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────────── Tabs ───────────────────────────── */

function RunTabs(p: {
  s: RunState; tab: Tab; setTab: (t: Tab) => void; osi: OsiClient; engine: Engine; keyValue: string; ready: boolean;
  selected: string | null; onSelect: (k: string | null) => void; askTarget: string; setAskTarget: (t: string) => void; theater: boolean;
}) {
  const { s, tab, setTab } = p;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    ...(!p.theater && s.report ? [{ id: 'report' as Tab, label: 'Report' }] : []),
    { id: 'debate', label: 'Debate', count: s.posts.length || undefined },
    { id: 'panel', label: 'Panel', count: s.agents.length || undefined },
    { id: 'world', label: 'World', count: s.actors.length || undefined },
    { id: 'ask', label: 'Ask' },
  ];
  const current = tabs.some(t => t.id === tab) ? tab : 'debate';
  return (
    <div className={`flex flex-col ${p.theater ? 'h-full min-h-0' : ''}`}>
      <div role="tablist" className="flex items-stretch px-2 border-b border-[var(--border-secondary)] flex-shrink-0">
        {tabs.map(t => {
          const on = current === t.id;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`relative px-2.5 h-10 text-[9.5px] font-mono tracking-[0.18em] uppercase transition-colors ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              {t.label}{t.count ? <span className={`ml-1.5 tabular-nums ${on ? 'text-[var(--cyan-primary)]' : ''}`}>{t.count}</span> : null}
              {on && <motion.span layoutId={p.theater ? 'osi-tab-theater' : 'osi-tab'} className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: T.gold, boxShadow: `0 0 10px ${gold(0.7)}` }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            </button>
          );
        })}
      </div>
      <div className={`px-4 py-4 ${p.theater ? 'flex-1 min-h-0 overflow-y-auto styled-scrollbar' : ''}`}>
        {current === 'report' && s.report && <ReportBody s={s} runId={p.osi.runId} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'debate' && <DebateList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'panel' && <PanelList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'world' && <WorldList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'ask' && <AskBox s={s} osi={p.osi} engine={p.engine} keyValue={p.keyValue} ready={p.ready} target={p.askTarget} setTarget={p.setAskTarget} />}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

function Avatar({ name, size = 28, ring }: { name: string; size?: number; ring?: 'selected' | 'thinking' }) {
  return (
    <span className="rounded-full flex items-center justify-center font-mono font-medium flex-shrink-0 border"
      style={{
        width: size, height: size, fontSize: size * 0.32, color: T.body, background: 'var(--bg-tertiary)',
        borderColor: ring === 'selected' ? T.gold : ring === 'thinking' ? T.cyan : 'var(--border-primary)',
        boxShadow: ring === 'selected' ? `0 0 0 3px ${gold(0.15)}` : ring === 'thinking' ? `0 0 0 3px ${cyan(0.15)}` : undefined,
      }}>
      {initials(name)}
    </span>
  );
}

/** A panelist's view in figures, with a dot in its outcome's colour for a choice. */
function ViewTag({ post, frame }: { post: Post; frame: Frame | null }) {
  const lead = frame?.kind === 'choice' && post.shares ? leader(post.shares) : -1;
  return (
    <span className="inline-flex items-center gap-1.5 h-[20px] px-1.5 rounded border border-[var(--border-secondary)] bg-white/[0.03] text-[10px] font-mono tabular-nums whitespace-nowrap text-[var(--text-primary)]">
      {lead >= 0 && <span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(lead) }} />}
      {postView(post, frame)}
    </span>
  );
}

function DebateList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const [limit, setLimit] = useState(30);
  const names = useMemo(() => new Map(s.agents.map(a => [a.id, a])), [s.agents]);
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
  const roundLabel = (stat: RoundStat) => s.frame?.kind === 'number' && stat.value ? `MEDIAN ${formatAmount(stat.value.median)}`
    : s.frame?.kind === 'choice' && stat.shares ? `${s.frame.outcomes[leader(stat.shares)]} ${pct(Math.max(...stat.shares))}` : pct(stat.consensus);

  return (
    <div className="flex flex-col gap-3.5">
      {shown.map((it, i) => {
        if (it.kind === 'round') {
          return (
            <div key={`r${it.stat.round}`} className="flex items-center gap-2.5">
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
              <span className="text-[9px] font-mono tracking-[0.16em] uppercase whitespace-nowrap text-[var(--text-muted)]">Round {it.stat.round} · <span className="text-[var(--gold-light)]">{roundLabel(it.stat)}</span></span>
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
            </div>
          );
        }
        if (it.kind === 'inject') {
          return (
            <div key={`i${i}`} className="rounded-md px-3 py-2 flex items-start gap-2 border" style={{ background: 'rgba(255,149,0,0.06)', borderColor: 'rgba(255,149,0,0.25)' }}>
              <Zap className="w-3.5 h-3.5 mt-px flex-shrink-0 text-[var(--alert-orange)]" />
              <p className="text-[11px] leading-snug text-[var(--text-primary)]"><span className="text-[var(--text-muted)]">Injected before round {it.round} · </span>{it.text}</p>
            </div>
          );
        }
        const p = it.post;
        const a = names.get(p.agent);
        const key = `g:${p.agent}`;
        const on = selected === key;
        return (
          <motion.article key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={`flex gap-2.5 rounded-md -mx-2 px-2 py-1.5 transition-colors ${on ? 'bg-[var(--hover-accent)]' : ''}`}>
            <button onClick={() => onSelect(on ? null : key)} aria-label={`Select ${a?.name ?? p.agent}`} className="self-start"><Avatar name={a?.name ?? '?'} ring={on ? 'selected' : undefined} /></button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <button onClick={() => onSelect(on ? null : key)} className="text-[11.5px] font-semibold truncate text-[var(--text-heading)] hover:text-[var(--gold-light)]">{a?.name ?? p.agent}</button>
                <span className="text-[10px] truncate text-[var(--text-muted)]">{a?.role}</span>
                <span className="ml-auto"><ViewTag post={p} frame={s.frame} /></span>
              </div>
              <p className="mt-1 text-[11.5px] leading-[1.55] text-[var(--text-secondary)]">{p.text}</p>
              {p.replies.length > 0 && (
                <div className="mt-1.5 pl-2.5 flex flex-col gap-0.5 border-l border-[var(--border-primary)]">
                  {p.replies.map((r, j) => {
                    const linkKey = `link:rp:${p.agent}:${r.to}`;
                    const tone = r.stance === 'agree' ? T.support : r.stance === 'disagree' ? T.oppose : T.neutral;
                    return (
                      <button key={j} onClick={() => onSelect(selected === linkKey ? null : linkKey)} className="text-left text-[10.5px] leading-snug text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        <span style={{ color: tone }}>{r.stance === 'agree' ? 'Agrees with' : r.stance === 'disagree' ? 'Disputes' : 'Questions'}</span>{' '}
                        <span className="text-[var(--text-secondary)]">{names.get(r.to)?.name ?? r.to}</span>{r.point && <> · “{r.point}”</>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.article>
        );
      })}
      {items.length > limit && <button onClick={() => setLimit(l => l + 30)} className={`self-center h-7 px-3 rounded-md ${LABEL} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)]`}>Show earlier</button>}
    </div>
  );
}

/** How a panelist moved across the rounds, on the same scale as the rest of the panel. */
function Spark({ s, agent, on }: { s: RunState; agent: string; on: boolean }) {
  if (s.posts.filter(p => p.agent === agent).length < 2) return <span className="w-[44px]" />;
  const last = s.rounds[s.rounds.length - 1]?.shares;
  const lead = last ? leader(last) : 0;
  const [elo, ehi] = estimateRange(s);
  const view = (p: Post) => s.frame?.kind === 'number' ? positionIn(p.estimate?.value ?? NaN, elo, ehi)
    : s.frame?.kind === 'choice' ? p.shares?.[lead] ?? 0 : p.probability;
  const all = s.posts.map(view).filter(Number.isFinite);
  const [lo, hi] = fit(all.length ? all : [0.5], 0.15);
  const vals = s.posts.filter(p => p.agent === agent).map(view);
  const W = 44, H = 16;
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (W - 4), H - 2 - ((v - lo) / (hi - lo)) * (H - 4)] as [number, number]);
  return <svg width={W} height={H} aria-hidden className="flex-shrink-0"><path d={smooth(pts)} fill="none" strokeWidth={1.3} strokeLinecap="round" style={{ stroke: on ? T.gold : T.body, opacity: on ? 1 : 0.7 }} /></svg>;
}

function PanelList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const latest = latestPosts(s);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selected?.startsWith('g:')) refs.current.get(selected.slice(2))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!s.agents.length) return <Empty>The panel has not been assembled yet.</Empty>;
  return (
    <div className="flex flex-col">
      {s.frame?.kind === 'choice' && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 mb-2 text-[9px] font-mono tracking-[0.1em] uppercase text-[var(--text-muted)]">
          {s.frame.outcomes.map((o, i) => <span key={o} className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(i) }} />{o}</span>)}
        </div>
      )}
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {s.agents.map(a => {
          const post = latest.get(a.id);
          const thinking = a.id in s.thinking;
          const key = `g:${a.id}`;
          const on = selected === key;
          return (
            <button key={a.id} ref={el => { if (el) refs.current.set(a.id, el); }} onClick={() => onSelect(on ? null : key)}
              className={`flex items-center gap-2.5 -mx-2 px-2 py-2 text-left transition-colors hover:bg-[var(--hover-accent)] ${on ? 'bg-[var(--hover-accent)]' : ''}`}>
              <Avatar name={a.name} size={30} ring={on ? 'selected' : thinking ? 'thinking' : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-semibold truncate text-[var(--text-heading)]">{a.name}</span>
                <span className="block text-[10px] truncate text-[var(--text-muted)]">{a.role}{a.place && ` · ${a.place}`}</span>
              </span>
              <Spark s={s} agent={a.id} on={on} />
              {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-[var(--cyan-primary)]" /> : post ? <ViewTag post={post} frame={s.frame} /> : <span className="text-[var(--text-muted)]">—</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** What the arcs on the globe mean, in their own (Style Studio) colours. */
function Legend({ floating = false }: { floating?: boolean }) {
  const rows: { label: string; color: string; dash?: string; opacity?: number }[] = [
    { label: 'Aligned · agrees', color: T.support },
    { label: 'Opposed · disputes', color: T.oppose },
    { label: 'Between · questions', color: T.neutral },
    { label: 'Evidence', color: T.neutral, opacity: 0.55 },
    { label: 'Weighing', color: T.neutral, dash: '4 3' },
  ];
  return (
    <div className={`flex flex-wrap ${floating ? 'glass-panel !rounded-full justify-center gap-x-5 gap-y-1.5 px-5 py-2.5' : 'gap-x-4 gap-y-1.5'}`}>
      {rows.map(r => (
        <span key={r.label} className="inline-flex items-center gap-2 text-[9px] font-mono tracking-[0.12em] uppercase text-[var(--text-secondary)]">
          <svg width="20" height="6" aria-hidden><line x1="1" x2="19" y1="3" y2="3" strokeWidth="2" strokeDasharray={r.dash} strokeLinecap="round" style={{ stroke: r.color, opacity: r.opacity ?? 1 }} /></svg>
          {r.label}
        </span>
      ))}
    </div>
  );
}

function LineGlyph({ link }: { link: Link }) {
  return (
    <svg width="18" height="6" className="flex-shrink-0" aria-hidden>
      <line x1="1" x2="17" y1="3" y2="3" strokeWidth="2" strokeDasharray={link.kind === 'focus' ? '4 3' : undefined} strokeLinecap="round"
        style={{ stroke: toneColor(link.tone), opacity: link.kind === 'evidence' ? 0.55 : 1 }} />
    </svg>
  );
}

function Row({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 -mx-2 px-2 py-1.5 rounded text-left transition-colors hover:bg-[var(--hover-accent)] ${on ? 'bg-[var(--hover-accent)]' : ''}`} style={{ width: 'calc(100% + 16px)' }}>
      {children}
    </button>
  );
}

function WorldList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const relations = s.links.filter(l => l.kind === 'relation');
  if (!s.actors.length) return <Empty>The world model is being mapped.</Empty>;
  const pick = (key: string) => onSelect(selected === key ? null : key);
  return (
    <div className="flex flex-col gap-5">
      <Legend />
      <div>
        <SectionTitle count={s.actors.length}>Actors</SectionTitle>
        {s.actors.map(a => (
          <Row key={a.id} on={selected === `a:${a.id}`} onClick={() => pick(`a:${a.id}`)}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: gold(0.2), boxShadow: `inset 0 0 0 1.5px ${T.gold}` }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-semibold truncate text-[var(--text-heading)]">{a.name}</span>
              <span className="block text-[10px] truncate text-[var(--text-muted)]">{a.role}</span>
            </span>
            <span className="text-[8.5px] font-mono tracking-[0.14em] uppercase text-[var(--text-muted)]">{a.kind}</span>
          </Row>
        ))}
      </div>
      {relations.length > 0 && (
        <div>
          <SectionTitle count={relations.length}>Relations</SectionTitle>
          {relations.map(l => (
            <Row key={l.id} on={selected === `link:${l.id}`} onClick={() => pick(`link:${l.id}`)}>
              <LineGlyph link={l} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] truncate text-[var(--text-primary)]">{nodeName(s, l.from)} <span className="text-[var(--text-muted)]">⇄</span> {nodeName(s, l.to)}</span>
                <span className="block text-[10px] truncate text-[var(--text-muted)]">{l.label}</span>
              </span>
            </Row>
          ))}
        </div>
      )}
      <ContextList s={s} selected={selected} onSelect={onSelect} />
    </div>
  );
}

function ContextList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  if (!s.context.length) return s.status === 'running' && !s.actors.length ? <Empty>Reading the live feeds.</Empty> : null;
  const cited = new Set(s.links.filter(l => l.kind === 'evidence').map(l => l.from.slice(2)));
  return (
    <div>
      <SectionTitle count={s.context.length}>Live intelligence</SectionTitle>
      {s.context.map((c: ContextItem) => {
        const key = `c:${c.id}`;
        return (
          <Row key={c.id} on={selected === key} onClick={() => onSelect(selected === key ? null : key)}>
            <span className="self-start mt-[6px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cited.has(c.id) ? T.cyan : 'var(--text-muted)', boxShadow: cited.has(c.id) ? `0 0 6px ${cyan(0.8)}` : undefined }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-snug text-[var(--text-primary)]">{c.title}</span>
              <span className="block mt-0.5 text-[9px] font-mono tracking-[0.08em] truncate text-[var(--text-muted)]">{[c.source, c.place, ago(c.published)].filter(Boolean).join(' · ')}</span>
            </span>
          </Row>
        );
      })}
    </div>
  );
}

function AskBox({ s, osi, engine, keyValue, ready, target, setTarget }: { s: RunState; osi: OsiClient; engine: Engine; keyValue: string; ready: boolean; target: string; setTarget: (t: string) => void }) {
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
    const out = await osi.ask(target, m, engine, keyValue);
    setLog(l => [...l, { who: targetName, text: out.reply ?? out.error ?? '…', you: false }]);
    setBusy(false);
  };
  if (!s.agents.length) return <Empty>The panel can be questioned once it has been assembled.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Who to ask" className={`${FIELD} h-8 px-2 text-[11px]`}>
        <option value="report" disabled={!s.report} style={{ background: '#0C0E1A' }}>The report agent{!s.report ? ' (once the report is written)' : ''}</option>
        {s.agents.map(a => <option key={a.id} value={a.id} style={{ background: '#0C0E1A' }}>{a.name} · {a.role}</option>)}
      </select>
      {log.length === 0 && <Empty>Ask why the forecast landed where it did, what would change a panelist&apos;s mind, or what to watch next. Questions run on your key.</Empty>}
      {log.map((m, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className={`max-w-[88%] rounded-lg px-3 py-2 text-[11.5px] leading-relaxed border ${m.you ? 'self-end' : 'self-start'}`}
          style={m.you ? { color: T.text, background: gold(0.1), borderColor: gold(0.3) } : { color: T.body, background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border-secondary)' }}>
          {!m.you && <span className={`block mb-1 ${LABEL} !text-[8.5px] text-[var(--cyan-primary)]`}>{m.who}</span>}
          <span className="whitespace-pre-wrap">{m.text}</span>
        </motion.div>
      ))}
      <div className="flex items-center gap-2 h-9 pl-3 pr-1 rounded-md border border-[var(--border-primary)] bg-black/40 focus-within:border-[var(--border-active)] transition-colors">
        <input value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} onKeyDown={e => e.key === 'Enter' && send()} disabled={!ready || (target === 'report' && !s.report)}
          placeholder={!ready ? 'Add your key to ask' : `Ask ${targetName.replace(/^The /, 'the ')}`} aria-label="Your question to the panel"
          className="flex-1 bg-transparent outline-none text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50" />
        <button onClick={send} disabled={!ready || busy || !message.trim()} aria-label="Send"
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--gold-light)] hover:bg-[var(--hover-accent)] disabled:opacity-30 transition-colors">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── The inspector ───────────────────────────── */

function NodeName({ s, k, onSelect }: { s: RunState; k: string; onSelect: (k: string | null) => void }) {
  return <button onClick={() => onSelect(k)} className="text-[var(--text-heading)] hover:text-[var(--gold-light)] transition-colors">{nodeName(s, k)}</button>;
}

function PostCardView({ s, post, note, onSelect }: { s: RunState; post: Post; note?: string; onSelect: (k: string | null) => void }) {
  const a = s.agents.find(x => x.id === post.agent);
  return (
    <div className="rounded-md border border-[var(--border-secondary)] bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar name={a?.name ?? '?'} size={22} />
        <button onClick={() => onSelect(`g:${post.agent}`)} className="text-[11px] font-semibold truncate text-[var(--text-heading)] hover:text-[var(--gold-light)]">{a?.name ?? post.agent}</button>
        <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-[var(--text-muted)]">{note ?? `round ${post.round}`}</span>
        <span className="ml-auto"><ViewTag post={post} frame={s.frame} /></span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[var(--text-secondary)]">{post.text}</p>
      {post.reasoning && <p className="mt-1 text-[10.5px] italic leading-snug text-[var(--text-muted)]">{post.reasoning}</p>}
      {post.changed && post.changed.toLowerCase() !== 'nothing' && <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Moved by {post.changed.replace(/^\w/, c => c.toLowerCase())}</p>}
    </div>
  );
}

function Inspector({ s, sel, onSelect, onLocate, onAsk, floating = false }: {
  s: RunState; sel: Selection; onSelect: (k: string | null) => void; onLocate: OsiPanelProps['onLocate']; onAsk: (agentId: string) => void; floating?: boolean;
}) {
  const place = (k: string) => {
    const [prefix, ...rest] = k.split(':');
    const id = rest.join(':');
    const n = prefix === 'a' ? s.actors.find(a => a.id === id) : prefix === 'g' ? s.agents.find(a => a.id === id) : prefix === 'c' ? s.context.find(c => c.id === id) : null;
    return n && n.lat !== null && n.lng !== null ? { lat: n.lat, lng: n.lng } : null;
  };

  let kicker = '';
  let accent = T.gold;
  let title: ReactNode = null;
  let body: ReactNode = null;
  let locate: { lat: number; lng: number; zoom: number } | null = null;

  switch (sel.type) {
    case 'link': {
      const l = sel.link;
      accent = toneColor(l.tone);
      const a = place(l.from), b = place(l.to);
      if (a && b) locate = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2, zoom: 2.2 };
      if (l.kind === 'relation') {
        kicker = 'Relation';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="text-[var(--text-muted)]">⇄</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const actors = [l.from, l.to].map(k => s.actors.find(x => `a:${x.id}` === k)).filter(Boolean);
        body = (
          <>
            <div className="flex items-center gap-3">
              <span className="gotham-tag" style={{ color: accent, borderColor: tint(accent, 40), background: tint(accent, 12) }}>{l.tone === 'support' ? 'Aligned' : l.tone === 'oppose' ? 'Opposed' : 'Linked'}</span>
              <span className={`${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>Strength</span>
              <span className="w-20 h-[3px] rounded-full overflow-hidden bg-white/[0.08]"><span className="block h-full rounded-full" style={{ width: `${l.strength * 100}%`, background: accent }} /></span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{l.label}</p>
            <div className="grid grid-cols-2 gap-2">
              {actors.map(x => (
                <button key={x!.id} onClick={() => onSelect(`a:${x!.id}`)} className="text-left rounded-md border border-[var(--border-secondary)] bg-black/25 px-2.5 py-2 transition-colors hover:border-[var(--border-active)]">
                  <div className="text-[11px] font-semibold truncate text-[var(--text-heading)]">{x!.name}</div>
                  <div className="mt-0.5 text-[10px] leading-snug line-clamp-2 text-[var(--text-muted)]">{x!.role}</div>
                </button>
              ))}
            </div>
          </>
        );
      } else if (l.kind === 'evidence') {
        kicker = 'Evidence';
        const item = s.context.find(c => `c:${c.id}` === l.from);
        title = <span>{item?.title ?? nodeName(s, l.from)}</span>;
        const effect = s.frame?.kind === 'number' ? (l.tone === 'support' ? 'Points higher' : l.tone === 'oppose' ? 'Points lower' : 'Bears on')
          : l.tone === 'support' ? 'Points toward YES' : l.tone === 'oppose' ? 'Points toward NO' : 'Bears on';
        body = (
          <>
            {item && <p className="text-[9.5px] font-mono tracking-[0.08em] text-[var(--text-muted)]">{[item.source, item.place, ago(item.published)].filter(Boolean).join(' · ')}</p>}
            <p className="text-[11.5px] text-[var(--text-secondary)]">{effect}{effect === 'Bears on' ? ' ' : ', through '}<NodeName s={s} k={l.to} onSelect={onSelect} /></p>
            {l.label && <blockquote className="pl-2.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)] border-l-2" style={{ borderColor: accent }}>{l.label}</blockquote>}
          </>
        );
      } else if (l.kind === 'reply') {
        kicker = `Exchange · round ${l.round}`;
        const verb = l.tone === 'support' ? 'agrees with' : l.tone === 'oppose' ? 'disputes' : 'questions';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="font-normal text-[var(--text-muted)]">{verb}</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const said = postFor(s, l);
        const answered = s.posts.filter(p => `g:${p.agent}` === l.to && p.round === l.round - 1)[0] ?? s.posts.filter(p => `g:${p.agent}` === l.to && p.round <= l.round).at(-1);
        body = (
          <>
            {l.label && <blockquote className="pl-2.5 text-[12px] leading-relaxed text-[var(--text-primary)] border-l-2" style={{ borderColor: accent }}>“{l.label}”</blockquote>}
            {answered && <PostCardView s={s} onSelect={onSelect} post={answered} note={`said · round ${answered.round}`} />}
            {said && <PostCardView s={s} onSelect={onSelect} post={said} note={`replied · round ${said.round}`} />}
          </>
        );
      } else {
        kicker = l.round ? `Weighing · round ${l.round}` : 'Watching';
        title = <><NodeName s={s} k={l.from} onSelect={onSelect} /> <span className="font-normal text-[var(--text-muted)]">{l.round ? 'weighing' : 'watches'}</span> <NodeName s={s} k={l.to} onSelect={onSelect} /></>;
        const said = postFor(s, l);
        const actor = s.actors.find(x => `a:${x.id}` === l.to);
        body = (
          <>
            {actor && <p className="text-[11px] leading-snug text-[var(--text-muted)]">{actor.role}</p>}
            {said && <PostCardView s={s} onSelect={onSelect} post={said} />}
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
          <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{a.role}{a.place && <span className="text-[var(--text-muted)]"> · {a.place}</span>}</p>
          {s.frame?.kind !== 'choice' && (
            <div className="flex items-center gap-3">
              <span className={`${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>Lean</span>
              <span className="relative w-28 h-[3px] rounded-full bg-white/[0.08]">
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />
                <span className="absolute -top-[5px] w-[2px] h-[13px] -ml-px rounded-full" style={{ left: `${(0.5 + a.lean / 2) * 100}%`, background: T.goldLight, boxShadow: `0 0 8px ${gold(0.8)}` }} />
              </span>
              <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-[var(--text-secondary)]">
                {s.frame?.kind === 'number' ? (a.lean > 0.15 ? 'pushes higher' : a.lean < -0.15 ? 'pushes lower' : 'balanced') : a.lean > 0.15 ? 'toward YES' : a.lean < -0.15 ? 'toward NO' : 'balanced'}
              </span>
            </div>
          )}
          {rel.length > 0 && <List label="Relations">{rel.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="flex items-center gap-2.5 text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              <LineGlyph link={l} /> {nodeName(s, l.from === sel.key ? l.to : l.from)}
            </button>
          ))}</List>}
          {ev.length > 0 && <List label="Evidence">{ev.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="text-left text-[11px] leading-snug line-clamp-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">{nodeName(s, l.from)}</button>
          ))}</List>}
          {watchers.length > 0 && <List label="Panelists weighing it"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{watchers.map(k => <NodeName key={k} s={s} k={k} onSelect={onSelect} />)}</div></List>}
        </>
      );
      break;
    }
    case 'agent': {
      const a = sel.agent;
      accent = T.cyan;
      if (a.lat !== null && a.lng !== null) locate = { lat: a.lat, lng: a.lng, zoom: 3.5 };
      kicker = 'Panelist';
      title = <span>{a.name}</span>;
      const posts = s.posts.filter(p => p.agent === a.id);
      const heard = s.posts.flatMap(p => p.replies.filter(r => r.to === a.id).map(r => ({ from: p.agent, round: p.round, r })));
      body = (
        <>
          <p className="text-[11.5px] text-[var(--text-secondary)]">{a.role}{a.place && <span className="text-[var(--text-muted)]"> · {a.place}</span>}</p>
          {(a.lens || a.bias) && <p className="text-[10.5px] leading-snug text-[var(--text-muted)]">{a.lens}{a.bias && <> Watches for {a.bias.replace(/^\w/, c => c.toLowerCase())}</>}</p>}
          {posts.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">Has not spoken yet.</p>}
          {posts.slice().reverse().map(p => <PostCardView key={p.id} s={s} onSelect={onSelect} post={p} />)}
          {heard.length > 0 && <List label="What the panel said to them">{heard.slice(-4).reverse().map((h, i) => (
            <p key={i} className="text-[11px] leading-snug text-[var(--text-muted)]">
              <NodeName s={s} k={`g:${h.from}`} onSelect={onSelect} /> {h.r.stance === 'agree' ? 'agreed' : h.r.stance === 'disagree' ? 'disputed' : 'asked'} in round {h.round}{h.r.point && <> · “{h.r.point}”</>}
            </p>
          ))}</List>}
          <button onClick={() => onAsk(a.id)} className="btn-tactical btn-tactical--cyan self-start flex items-center gap-2" style={{ padding: '6px 12px', fontSize: 10 }}>
            <MessageSquare className="w-3 h-3" /> Ask {a.name.split(' ')[0]}
          </button>
        </>
      );
      break;
    }
    case 'context': {
      const c = sel.item;
      accent = T.cyan;
      if (c.lat !== null && c.lng !== null) locate = { lat: c.lat, lng: c.lng, zoom: 4 };
      kicker = c.kind === 'quake' ? 'Earthquake' : c.kind === 'market' ? 'Markets' : 'Live intelligence';
      title = <span>{c.title}</span>;
      const bears = s.links.filter(l => l.kind === 'evidence' && l.from === sel.key);
      body = (
        <>
          <p className="text-[9.5px] font-mono tracking-[0.08em] text-[var(--text-muted)]">{[c.source, c.place, ago(c.published)].filter(Boolean).join(' · ')}</p>
          {bears.length ? <List label="Bears on">{bears.map(l => (
            <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="flex items-center gap-2.5 text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              <LineGlyph link={l} /> {nodeName(s, l.to)}{l.label && <span className="truncate text-[var(--text-muted)]"> · {l.label}</span>}
            </button>
          ))}</List> : <p className="text-[11px] text-[var(--text-muted)]">Read by the panel; not cited against a particular actor.</p>}
        </>
      );
      break;
    }
    case 'scenario': {
      const sc = sel.scenario;
      if (sc.lat !== null && sc.lng !== null) locate = { lat: sc.lat, lng: sc.lng, zoom: 4 };
      kicker = 'Scenario';
      title = <span>{sc.name} <span className="font-mono font-normal text-[var(--gold-light)]">{pct(sc.probability)}</span></span>;
      body = (
        <>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{sc.description}</p>
          {sc.place && <p className="text-[10.5px] text-[var(--text-muted)]">Plays out in {sc.place}</p>}
        </>
      );
      break;
    }
    case 'signpost': {
      const sp = sel.signpost;
      if (sp.lat !== null && sp.lng !== null) locate = { lat: sp.lat, lng: sp.lng, zoom: 4.5 };
      kicker = 'Signpost';
      title = <span>{sp.text}</span>;
      body = <p className="text-[11.5px] text-[var(--text-secondary)]">If it happens, the forecast moves <span className="font-mono uppercase text-[10px] tracking-[0.1em]" style={{ color: leanTo(s.frame, sp.means, sp.favors) }}>{directionWord(s.frame, sp.means, sp.favors)}</span>{sp.place && <span className="text-[var(--text-muted)]"> · {sp.place}</span>}</p>;
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
    <section ref={bringIntoView}
      className={`relative overflow-hidden flex flex-col gap-2.5 ${floating ? 'glass-panel p-4 max-h-[44vh] overflow-y-auto styled-scrollbar' : 'rounded-lg border border-[var(--border-primary)] p-3.5'}`}
      style={floating ? { background: 'rgba(8,10,20,0.96)' } : { background: gold(0.03) }}>
      {/* A rule in the colour of what is selected: its line's colour, or the theme accent for a node. */}
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: accent, opacity: 0.8 }} />
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <Overline color={accent}>{kicker}</Overline>
        {lit > 1 && <span className="text-[9px] font-mono tracking-[0.1em] text-[var(--text-muted)]">· {lit} LINKS LIT</span>}
        <span className="ml-auto flex items-center -mr-1.5">
          {locate && <IconButton title="Show on the globe" onClick={() => onLocate(locate!.lat, locate!.lng, locate!.zoom)}><LocateFixed className="w-3.5 h-3.5" /></IconButton>}
          <IconButton title="Close" onClick={() => onSelect(null)}><X className="w-3.5 h-3.5" /></IconButton>
        </span>
      </div>
      <h4 className="text-[13.5px] font-semibold leading-snug text-[var(--text-heading)]">{title}</h4>
      {body}
    </section>
  );
}

function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <Overline>{label}</Overline>
      {children}
    </div>
  );
}

/* ───────────────────────────── Footer and history ───────────────────────────── */

function UsageLine({ s }: { s: RunState }) {
  const tokens = s.usage.input + s.usage.output;
  const answer = currentAnswer(s);
  return (
    <div className="px-4 py-2 border-t border-[var(--border-secondary)] text-[9px] font-mono tracking-[0.06em] flex flex-wrap gap-x-2.5 gap-y-0.5 text-[var(--text-muted)]">
      <span>{s.provider} / {s.model}</span>
      <span>{s.usage.calls} calls</span>
      {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
      {answer && <span className="text-[var(--gold-primary)]">{answer}</span>}
      {s.warnings.length > 0 && <span title={s.warnings.join('\n')} className="text-[var(--alert-orange)]">{s.warnings.length} hiccup{s.warnings.length === 1 ? '' : 's'}</span>}
    </div>
  );
}

function HistoryList({ osi, onPick }: { osi: OsiClient; onPick: (id: string) => void }) {
  return (
    <section className="px-4 py-4">
      <SectionTitle count={osi.history.length || undefined}>Your forecasts</SectionTitle>
      {!osi.history.length && <Empty>Nothing yet. Forecasts you run are listed here, in this browser only. The server keeps a run for a few hours.</Empty>}
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {osi.history.map(h => (
          <div key={h.id} className="group flex items-center gap-3 py-2">
            <button onClick={() => onPick(h.id)} className="flex-1 min-w-0 text-left">
              <span className="block text-[11.5px] truncate text-[var(--text-primary)] transition-colors group-hover:text-[var(--gold-light)]">{h.question}</span>
              <span className="block mt-0.5 text-[9px] font-mono tracking-[0.08em] uppercase text-[var(--text-muted)]">{new Date(h.at).toLocaleString()} · {h.status}</span>
            </button>
            <span className="text-[10.5px] font-mono tabular-nums max-w-[130px] truncate text-[var(--gold-primary)]">{h.answer ?? pct(h.probability)}</span>
            <button onClick={() => osi.forget(h.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-[var(--alert-red)]" aria-label="Remove from history"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
