'use client';
/**
 * OSIRIS OAI — the panel. Set up an engine with your own key, ask a
 * question, and watch a simulated panel of forecasters debate it while the
 * analysis draws itself on the globe; then read the report and question the
 * panel. The run itself lives in the page (useOai), so closing this panel
 * leaves the globe drawing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, ChevronUp, Copy, Crosshair, Download, Eye, EyeOff, History, KeyRound, Loader2, Maximize2, MapPin,
  MessageSquare, Minimize2, Plus, Send, Sparkles, Square, Trash2, Zap,
} from 'lucide-react';
import { PROVIDERS, providerInfo, type ProviderId } from '@/lib/oai/providers';
import { DEPTHS, estimateCalls } from '@/lib/oai/depths';
import { checkKey, forgetKey, loadEngine, loadKey, saveEngine, saveKey, toMarkdown, type Engine, type OaiClient } from '@/lib/oai/client';
import { currentProbability, latestPosts, type RunState } from '@/lib/oai/state';
import { leanColor } from '@/lib/oai/globe';
import type { Depth, Post } from '@/lib/oai/types';

const ACCENT = '#B388FF';
const HOT = '#FF5CCB';

const EXAMPLES = [
  'Will Brent crude settle above $90 a barrel on 31 December 2026?',
  'Will Russia and Ukraine agree a ceasefire before 1 July 2027?',
  'Will the US Federal Reserve cut rates at its next meeting?',
  'Will Bitcoin trade above $150,000 at any point before 2027?',
];

const PHASES: { id: RunState['phase']; label: string }[] = [
  { id: 'context', label: 'Feeds' },
  { id: 'graph', label: 'World' },
  { id: 'agents', label: 'Panel' },
  { id: 'simulate', label: 'Debate' },
  { id: 'report', label: 'Report' },
];

const pct = (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`);
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

interface Props {
  oai: OaiClient;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  /** A node clicked on the globe ("g:<agent id>", "a:<actor id>"). */
  selected: string | null;
  onClose?: () => void;
  /** Inside another container (the phone drawer): no frame of its own, no full screen. */
  embedded?: boolean;
  /** Whether the other map layers are hidden so the analysis stands out, and the switch for it. */
  focus?: boolean;
  onFocus?: () => void;
}

/** The engine this browser last used, or OpenAI with its default model. */
function initialEngine(): Engine {
  const saved = loadEngine();
  if (saved && PROVIDERS.some(p => p.id === saved.provider)) return saved;
  return { provider: 'openai', model: providerInfo('openai').defaultModel, remember: false };
}

export default function OaiPanel({ oai, onLocate, selected, onClose, embedded = false, focus = false, onFocus }: Props) {
  // Settings come from this browser's storage. The panel only renders once opened, on the client.
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [key, setKey] = useState(() => loadKey(initialEngine().provider));
  const [engineOpen, setEngineOpen] = useState(() => {
    const e = initialEngine();
    return providerInfo(e.provider).needsKey && !loadKey(e.provider);
  });
  /** Over a run the engine card starts folded: a visitor following a shared link has come to read, not to configure. */
  const [engineOpenInRun, setEngineOpenInRun] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [question, setQuestion] = useState('');
  const [seed, setSeed] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [depth, setDepth] = useState<Depth>('standard');
  const [useFeeds, setUseFeeds] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const info = providerInfo(engine.provider);
  const ready = !info.needsKey || key.length > 0;
  const s = oai.state;

  const run = async () => {
    if (!ready || question.trim().length < 8 || starting) return;
    setStarting(true);
    const id = await oai.start({ question: question.trim(), seed, depth, useFeeds }, engine, key);
    setStarting(false);
    if (id) setShowHistory(false);
  };

  const body = (
    <div className={fullscreen ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.9fr)] gap-4 h-full min-h-0' : 'flex flex-col gap-3'}>
      <div className={fullscreen ? 'flex flex-col gap-3 min-h-0 overflow-y-auto styled-scrollbar pr-1' : 'flex flex-col gap-3'}>
        <EngineCard
          engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey}
          open={s ? engineOpenInRun : engineOpen} setOpen={s ? setEngineOpenInRun : setEngineOpen}
        />
        {oai.error && (
          <div className="rounded-lg border border-[var(--alert-red)]/40 bg-[var(--alert-red)]/10 px-3 py-2 text-[11px] text-[var(--text-primary)] flex items-start gap-2">
            <span className="flex-1">{oai.error}</span>
            <button onClick={() => oai.setError('')} className="text-[var(--text-muted)] hover:text-white text-[10px]">dismiss</button>
          </div>
        )}
        {showHistory ? (
          <HistoryList oai={oai} onPick={id => { setShowHistory(false); void oai.watch(id); }} />
        ) : !s ? (
          <AskForm
            question={question} setQuestion={setQuestion} seed={seed} setSeed={setSeed} showSeed={showSeed} setShowSeed={setShowSeed}
            depth={depth} setDepth={setDepth} useFeeds={useFeeds} setUseFeeds={setUseFeeds}
            ready={ready} starting={starting} onRun={run} providerName={info.name}
          />
        ) : (
          <>
            <RunHeader s={s} oai={oai} focus={focus} onFocus={onFocus} />
            {s.report ? <ReportView s={s} onLocate={onLocate} runId={oai.runId} /> : null}
          </>
        )}
      </div>
      {s && !showHistory && (
        <>
          <div className={fullscreen ? 'min-h-0 overflow-y-auto styled-scrollbar pr-1 flex flex-col gap-3' : 'flex flex-col gap-3'}>
            {s.status === 'running' && oai.canSteer && <InjectBox oai={oai} s={s} />}
            <DebateFeed s={s} />
          </div>
          <div className={fullscreen ? 'min-h-0 overflow-y-auto styled-scrollbar pr-1 flex flex-col gap-3' : 'flex flex-col gap-3'}>
            <PanelList s={s} selected={selected} onLocate={onLocate} />
            {s.agents.length > 0 && <AskPanel key={oai.runId ?? ''} s={s} oai={oai} engine={engine} keyValue={key} ready={ready} selected={selected} />}
            <UsageLine s={s} />
          </div>
        </>
      )}
    </div>
  );

  const header = (
    <div className={`flex items-center gap-2 ${fullscreen ? 'px-6 py-3.5 border-b border-[var(--border-secondary)] bg-[#111] flex-shrink-0' : 'px-3 py-2.5 border-b border-[var(--border-secondary)]'}`}>
      <Sparkles className={fullscreen ? 'w-5 h-5' : 'w-4 h-4'} style={{ color: ACCENT }} />
      <span className={`hud-text ${fullscreen ? 'text-[16px]' : 'text-[12px]'} text-[var(--text-primary)] tracking-[0.2em]`}>OAI</span>
      <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-wider truncate">SWARM FORECASTING · BYOK</span>
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton title={showHistory ? 'Back' : 'Your forecasts'} onClick={() => setShowHistory(v => !v)} active={showHistory}><History className="w-3.5 h-3.5" /></IconButton>
        {s && <IconButton title="New forecast" onClick={() => { oai.clear(); setShowHistory(false); }}><Plus className="w-3.5 h-3.5" /></IconButton>}
        {!embedded && (
          <IconButton title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFullscreen(v => !v)}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </IconButton>
        )}
        {onClose && !fullscreen && <IconButton title="Close (the run keeps going)" onClick={onClose}><span className="text-[13px] leading-none">×</span></IconButton>}
      </div>
    </div>
  );

  if (fullscreen) {
    const node = (
      <div className="fixed inset-4 z-[999] flex items-center justify-center">
        <div className="absolute inset-[-1rem] bg-black/60 backdrop-blur-sm" onClick={() => setFullscreen(false)} />
        <div className="relative w-full h-full max-w-[1500px] glass-panel bg-[#0a0a09]/97 backdrop-blur-2xl rounded-xl flex flex-col overflow-hidden shadow-2xl" style={{ borderColor: `${ACCENT}55`, boxShadow: `0 0 60px ${ACCENT}22` }}>
          {header}
          <div className="flex-1 min-h-0 p-5">{body}</div>
        </div>
      </div>
    );
    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
  }

  if (embedded) {
    return <div className="flex flex-col">{header}<div className="pt-3">{body}</div></div>;
  }

  return (
    <div className="glass-panel rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]" style={{ borderColor: `${ACCENT}40` }}>
      {header}
      <div className="p-3 min-h-0 overflow-y-auto styled-scrollbar">{body}</div>
    </div>
  );
}

/* ───────────────────────────── Pieces ───────────────────────────── */

function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${active ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-white/5'}`}>
      {children}
    </button>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border-primary)] bg-black/25">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-secondary)]">
        <span className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">{title}</span>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

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
    setStatus({ kind: 'ok', text: `Key works · ${out.models.length} model${out.models.length === 1 ? '' : 's'}` });
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
      <button onClick={() => setOpen(true)} className="w-full rounded-lg border border-[var(--border-primary)] bg-black/25 px-3 py-2 flex items-center gap-2 text-left hover:border-[var(--border-active)] transition-colors">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ready ? '#3DDC84' : '#FFB020', boxShadow: `0 0 6px ${ready ? '#3DDC84' : '#FFB020'}` }} />
        <span className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">ENGINE</span>
        <span className="text-[11px] text-[var(--text-primary)] truncate">{info.name}</span>
        <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{engine.model}</span>
        <span className="ml-auto text-[9px] text-[var(--text-muted)]">{ready ? 'change' : 'add key'}</span>
      </button>
    );
  }

  return (
    <Section title="ENGINE · YOUR OWN KEY" right={ready && <button onClick={() => setOpen(false)} className="text-[9px] text-[var(--text-muted)] hover:text-white">done</button>}>
      <div className="grid grid-cols-3 gap-1">
        {PROVIDERS.map(p => (
          <button key={p.id} onClick={() => pickProvider(p.id)}
            className={`px-1.5 py-1.5 rounded text-[10px] border transition-colors truncate ${engine.provider === p.id ? 'text-white' : 'text-[var(--text-secondary)] border-transparent bg-white/[0.03] hover:bg-white/[0.07]'}`}
            style={engine.provider === p.id ? { borderColor: `${ACCENT}99`, background: `${ACCENT}1f` } : undefined}
            title={p.name}>
            {p.name.replace(' (Alibaba Cloud)', '').replace(' (scripted, dev only)', '')}
          </button>
        ))}
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
              className="px-2.5 py-1.5 rounded text-[10px] font-mono tracking-wider border transition-colors disabled:opacity-40"
              style={{ borderColor: `${ACCENT}80`, color: ACCENT }}>
              {status.kind === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'CHECK'}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1.5 text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={engine.remember} onChange={e => {
                const next = { ...engine, remember: e.target.checked };
                setEngine(next); saveEngine(next); saveKey(engine.provider, keyValue, next.remember);
              }} className="accent-[#B388FF]" />
              Remember on this device
            </label>
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-white">Get a key ↗</a>
            {keyValue && <button onClick={() => { forgetKey(engine.provider); setKey(''); setModels(null); setStatus({ kind: 'idle', text: '' }); }} className="ml-auto text-[var(--text-muted)] hover:text-[var(--alert-red)]">forget key</button>}
          </div>
        </>
      ) : (
        <p className="mt-3 text-[10px] text-[var(--text-secondary)]">Scripted answers for trying the pipeline on a development server. No key, no cost, no real analysis.</p>
      )}

      {status.text && (
        <p className={`mt-2 text-[10px] ${status.kind === 'error' ? 'text-[var(--alert-red)]' : 'text-[#3DDC84]'}`}>
          {status.kind === 'ok' && <Check className="w-3 h-3 inline mr-1" />}{status.text}
        </p>
      )}

      <div className="mt-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">MODEL</span>
          {(models?.length ?? 0) > 12 && (
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…"
              className="ml-auto w-28 bg-black/40 border border-[var(--border-primary)] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] focus:outline-none" />
          )}
        </div>
        <select value={engine.model} onChange={e => { const next = { ...engine, model: e.target.value }; setEngine(next); saveEngine(next); }}
          className="w-full bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-active)]">
          {shown.map(m => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
        </select>
        {!models && info.needsKey && <p className="mt-1 text-[9px] text-[var(--text-muted)]">Check the key to list every model it can use.</p>}
      </div>

      {info.needsKey && (
        <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-muted)]">
          Your key stays in this browser{engine.remember ? '' : ' tab'} and is sent to OSIRIS only with your requests, which pass it to {info.name} for your run. It is never stored on our server or logged. A run makes about 15 to 70 model calls, billed to your {info.name} account.
        </p>
      )}
    </Section>
  );
}

function AskForm(p: {
  question: string; setQuestion: (v: string) => void; seed: string; setSeed: (v: string) => void; showSeed: boolean; setShowSeed: (v: boolean) => void;
  depth: Depth; setDepth: (d: Depth) => void; useFeeds: boolean; setUseFeeds: (v: boolean) => void;
  ready: boolean; starting: boolean; onRun: () => void; providerName: string;
}) {
  const valid = p.question.trim().length >= 8;
  return (
    <Section title="ASK THE OAI">
      <textarea
        value={p.question} onChange={e => p.setQuestion(e.target.value.slice(0, 500))} rows={3}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) p.onRun(); }}
        placeholder="Will … happen by …?" aria-label="Your question"
        className="w-full resize-none bg-black/40 border border-[var(--border-primary)] rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]"
      />
      {!p.question && (
        <div className="mt-1.5 flex flex-col gap-1">
          {EXAMPLES.map(q => (
            <button key={q} onClick={() => p.setQuestion(q)} className="text-left text-[10px] text-[var(--text-secondary)] hover:text-white px-2 py-1 rounded bg-white/[0.02] hover:bg-white/[0.06] transition-colors truncate">
              {q}
            </button>
          ))}
        </div>
      )}

      <button onClick={() => p.setShowSeed(!p.showSeed)} className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-white">
        {p.showSeed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Add your own material {p.seed && `(${p.seed.length.toLocaleString()} chars)`}
      </button>
      {p.showSeed && (
        <textarea value={p.seed} onChange={e => p.setSeed(e.target.value.slice(0, 20_000))} rows={5}
          placeholder="Paste a report, notes, a policy draft… The panel reads it alongside the live feeds."
          className="mt-1 w-full resize-y bg-black/40 border border-[var(--border-primary)] rounded-md px-2.5 py-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]" />
      )}

      <div className="mt-3 grid grid-cols-3 gap-1">
        {(Object.keys(DEPTHS) as Depth[]).map(d => (
          <button key={d} onClick={() => p.setDepth(d)}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${p.depth === d ? 'text-white' : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-white/[0.04]'}`}
            style={p.depth === d ? { borderColor: `${ACCENT}99`, background: `${ACCENT}1a` } : undefined}>
            <div className="text-[10px] font-mono tracking-wider">{DEPTHS[d].label.toUpperCase()}</div>
            <div className="text-[9px] text-[var(--text-muted)]">{DEPTHS[d].agents} agents × {DEPTHS[d].rounds} rounds</div>
            <div className="text-[9px] text-[var(--text-muted)]">≈ {estimateCalls(d)} calls</div>
          </button>
        ))}
      </div>

      <label className="mt-2.5 flex items-center gap-2 text-[10px] text-[var(--text-secondary)] cursor-pointer">
        <input type="checkbox" checked={p.useFeeds} onChange={e => p.setUseFeeds(e.target.checked)} className="accent-[#B388FF]" />
        Ground it in the live OSIRIS feeds (news, conflict, quakes, markets)
      </label>

      <button onClick={p.onRun} disabled={!p.ready || !valid || p.starting}
        className="mt-3 w-full py-2.5 rounded-md text-[11px] font-mono tracking-[0.25em] text-white transition-all disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ background: `linear-gradient(90deg, ${ACCENT}55, ${HOT}44)`, border: `1px solid ${ACCENT}aa`, boxShadow: p.ready && valid ? `0 0 18px ${ACCENT}33` : undefined }}>
        {p.starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        RUN THE SWARM
      </button>
      {!p.ready && <p className="mt-1.5 text-[10px] text-[#FFB020]">Add your {p.providerName} key above to turn the engine on.</p>}

      <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-muted)]">
        A simulated panel debates your question in rounds while the analysis draws itself on the globe. Method after{' '}
        <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">MiroFish</a>, rebuilt natively for OSIRIS. Also on the{' '}
        <a href="/docs#oai" className="underline hover:text-white">API and MCP</a>. A simulation, not a guarantee.
      </p>
    </Section>
  );
}

function Ring({ value, size = 84, label }: { value: number | null; size?: number; label: string }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={leanColor(value)} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.8s ease', filter: `drop-shadow(0 0 6px ${leanColor(value)}88)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-mono font-bold text-white leading-none tabular-nums">{pct(value)}</span>
        <span className="text-[8px] font-mono tracking-wider text-[var(--text-muted)] mt-1">{label}</span>
      </div>
    </div>
  );
}

function Trajectory({ s }: { s: RunState }) {
  const W = 150, H = 44;
  const pts = s.rounds.map(r => r.consensus);
  const base = s.frame?.baseRate ?? null;
  const all = [...pts, ...(s.report ? [s.report.probability] : [])];
  if (!all.length) return <div className="text-[10px] text-[var(--text-muted)]">The trajectory appears after round 1.</div>;
  const x = (i: number) => (all.length === 1 ? W / 2 : (i / (all.length - 1)) * (W - 8) + 4);
  const y = (p: number) => H - 4 - p * (H - 8);
  const last = s.rounds[s.rounds.length - 1];
  return (
    <div>
      <svg width={W} height={H} className="overflow-visible">
        {base !== null && <line x1={0} x2={W} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 3" />}
        <line x1={0} x2={W} y1={y(0.5)} y2={y(0.5)} stroke="rgba(255,255,255,0.06)" />
        <polyline fill="none" stroke={ACCENT} strokeWidth={1.5} points={all.map((p, i) => `${x(i)},${y(p)}`).join(' ')} />
        {all.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r={i === all.length - 1 ? 3 : 2} fill={i === all.length - 1 && s.report ? HOT : ACCENT} />)}
      </svg>
      {last && (
        <div className="mt-1 relative h-1.5 rounded-full bg-white/[0.06]" title={`Middle half of the panel: ${pct(last.p25)}–${pct(last.p75)}`}>
          <div className="absolute h-full rounded-full" style={{ left: `${last.p25 * 100}%`, width: `${Math.max(1, (last.p75 - last.p25) * 100)}%`, background: `${ACCENT}88` }} />
          <div className="absolute -top-0.5 w-0.5 h-2.5 bg-white" style={{ left: `${last.median * 100}%` }} />
        </div>
      )}
      <div className="mt-1 text-[9px] font-mono text-[var(--text-muted)]">
        {base !== null && <>base rate {pct(base)} · </>}{last ? <>spread {pct(last.p25)}–{pct(last.p75)}</> : 'warming up'}
      </div>
    </div>
  );
}

function RunHeader({ s, oai, focus, onFocus }: { s: RunState; oai: OaiClient; focus: boolean; onFocus?: () => void }) {
  const phaseIndex = s.status === 'done' ? PHASES.length : PHASES.findIndex(p => p.id === s.phase);
  const prob = currentProbability(s);
  const last = s.rounds[s.rounds.length - 1];
  return (
    <Section title={s.status === 'running' ? 'LIVE SIMULATION' : s.status === 'done' ? 'FORECAST' : s.status.toUpperCase()}
      right={
        <div className="flex items-center gap-2.5">
          {onFocus && (
            <button onClick={onFocus} title={focus ? 'Bring the other map layers back' : 'Hide the other map layers so the analysis stands out'}
              className={`flex items-center gap-1 text-[9px] transition-colors ${focus ? 'text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>
              <Crosshair className="w-2.5 h-2.5" style={focus ? { color: ACCENT } : undefined} /> {focus ? 'focused' : 'focus'}
            </button>
          )}
          {s.status === 'running' && oai.canSteer && (
            <button onClick={() => oai.cancel()} className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--alert-red)]"><Square className="w-2.5 h-2.5" /> stop</button>
          )}
        </div>
      }>
      <p className="text-[12px] text-[var(--text-primary)] leading-snug">{s.question}</p>
      {s.frame && s.frame.proposition !== s.question && (
        <p className="mt-1 text-[10px] text-[var(--text-secondary)] leading-snug">
          <span className="text-[var(--text-muted)]">Resolves YES if </span>{s.frame.proposition}{s.frame.horizon && <span className="text-[var(--text-muted)]"> · by {s.frame.horizon}</span>}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1">
        {PHASES.map((p, i) => {
          const done = i < phaseIndex;
          const now = i === phaseIndex && s.status === 'running';
          return (
            <div key={p.id} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-[3px] rounded-full overflow-hidden bg-white/[0.07]">
                <div className={`h-full rounded-full ${now ? 'animate-pulse' : ''}`} style={{ width: done || now ? '100%' : '0%', background: done ? ACCENT : `${ACCENT}aa`, transition: 'width 0.6s ease' }} />
              </div>
              <span className={`text-[8px] font-mono tracking-wider ${now ? 'text-white' : done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>{p.label.toUpperCase()}</span>
            </div>
          );
        })}
      </div>
      {s.status === 'running' && (
        <p className="mt-2 text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: ACCENT }} /> {s.phaseLabel || 'Starting'}
          {Object.keys(s.thinking).length > 0 && <span className="text-[var(--text-muted)]">· {Object.keys(s.thinking).length} thinking</span>}
        </p>
      )}
      {s.status === 'failed' && <p className="mt-2 text-[11px] text-[var(--alert-red)]">{s.message || 'The run failed.'}</p>}
      {s.status === 'cancelled' && <p className="mt-2 text-[11px] text-[var(--text-muted)]">Stopped.</p>}

      <div className="mt-3 flex items-center gap-4">
        <Ring value={prob} label={s.report ? 'FINAL' : last ? `ROUND ${last.round}/${s.roundsPlanned}` : 'PENDING'} />
        <Trajectory s={s} />
      </div>
    </Section>
  );
}

function ReportView({ s, onLocate, runId }: { s: RunState; onLocate: Props['onLocate']; runId: string | null }) {
  const r = s.report!;
  const [copied, setCopied] = useState('');
  const url = typeof window !== 'undefined' && runId ? `${window.location.origin}/?oai=${runId}` : '';
  const copy = async (what: 'link' | 'md') => {
    try {
      await navigator.clipboard.writeText(what === 'link' ? url : toMarkdown(s, url));
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const blob = new Blob([toMarkdown(s, url)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `osiris-oai-${(runId ?? 'forecast').slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const conf = { low: '#FFB020', medium: ACCENT, high: '#3DDC84' }[r.confidence];
  return (
    <Section title="THE REPORT" right={
      <div className="flex items-center gap-2 text-[9px]">
        <button onClick={() => copy('link')} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-white">{copied === 'link' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} link</button>
        <button onClick={download} className="flex items-center gap-1 text-[var(--text-muted)] hover:text-white"><Download className="w-3 h-3" /> .md</button>
      </div>
    }>
      <h3 className="text-[13px] font-semibold text-white leading-snug">{r.headline}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] font-mono">
        <span className="px-1.5 py-0.5 rounded" style={{ background: `${conf}22`, color: conf }}>{r.confidence.toUpperCase()} CONFIDENCE</span>
        <span className="text-[var(--text-muted)]">panel {pct(r.swarm)} · report {pct(r.probability)}</span>
      </div>
      {r.deviation && <p className="mt-1 text-[10px] italic text-[var(--text-muted)]">{r.deviation}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{r.summary}</p>

      {r.drivers.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)] mb-1">DRIVERS</div>
          {r.drivers.map((d, i) => (
            <div key={i} className="flex items-start gap-2 py-1">
              <span className="text-[10px] mt-px" style={{ color: d.push === 'yes' ? HOT : '#6E8BFF' }}>{d.push === 'yes' ? '▲' : '▼'}</span>
              <span className="flex-1 text-[10px] text-[var(--text-secondary)] leading-snug">{d.text}</span>
              <span className="w-10 h-1 mt-1.5 rounded-full bg-white/[0.06] overflow-hidden flex-shrink-0">
                <span className="block h-full" style={{ width: `${d.weight * 100}%`, background: d.push === 'yes' ? HOT : '#6E8BFF' }} />
              </span>
            </div>
          ))}
        </div>
      )}

      {r.scenarios.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)] mb-1">SCENARIOS</div>
          {r.scenarios.map((sc, i) => (
            <div key={i} className="py-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-primary)] flex-1 truncate">{sc.name}</span>
                {sc.lat !== null && sc.lng !== null && (
                  <button onClick={() => onLocate(sc.lat!, sc.lng!, 4)} className="text-[var(--text-muted)] hover:text-white" title={sc.place || 'Show on the globe'}><MapPin className="w-3 h-3" /></button>
                )}
                <span className="text-[10px] font-mono text-white tabular-nums w-9 text-right">{pct(sc.probability)}</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full" style={{ width: `${sc.probability * 100}%`, background: `linear-gradient(90deg, ${ACCENT}, ${HOT})` }} /></div>
              <p className="mt-0.5 text-[9px] text-[var(--text-muted)] leading-snug">{sc.description}</p>
            </div>
          ))}
        </div>
      )}

      {r.signposts.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)] mb-1">SIGNPOSTS TO WATCH</div>
          {r.signposts.map((sp, i) => (
            <button key={i} disabled={sp.lat === null} onClick={() => sp.lat !== null && sp.lng !== null && onLocate(sp.lat, sp.lng, 5)}
              className="w-full flex items-start gap-2 py-1 text-left group disabled:cursor-default">
              <span className="text-[9px] mt-px" style={{ color: sp.means === 'yes' ? HOT : '#6E8BFF' }}>◆</span>
              <span className="flex-1 text-[10px] text-[var(--text-secondary)] group-hover:text-white leading-snug">{sp.text}{sp.place && <span className="text-[var(--text-muted)]"> · {sp.place}</span>}</span>
              <span className="text-[8px] font-mono text-[var(--text-muted)]">→ {sp.means.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}

      {r.dissent && (
        <div className="mt-3 rounded-md border border-[var(--border-secondary)] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)] mb-0.5">DISSENT</div>
          <p className="text-[10px] text-[var(--text-secondary)] leading-snug">{r.dissent}</p>
        </div>
      )}
      {r.caveats.length > 0 && <ul className="mt-2 space-y-0.5">{r.caveats.map((c, i) => <li key={i} className="text-[9px] text-[var(--text-muted)]">· {c}</li>)}</ul>}
    </Section>
  );
}

function InjectBox({ oai, s }: { oai: OaiClient; s: RunState }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const late = s.phase === 'report';
  const send = async () => {
    if (text.trim().length < 3) return;
    const err = await oai.inject(text.trim());
    setMsg(err ?? 'Queued: the panel takes it up next round.');
    if (!err) setText('');
    setTimeout(() => setMsg(''), 3500);
  };
  return (
    <Section title="GOD'S-EYE VIEW">
      <div className="flex gap-1.5">
        <input value={text} onChange={e => setText(e.target.value.slice(0, 400))} onKeyDown={e => e.key === 'Enter' && send()} disabled={late}
          placeholder={late ? 'Too late: the report is being written' : 'Inject an event… e.g. "Talks collapse in Geneva"'}
          className="flex-1 bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] disabled:opacity-50" />
        <button onClick={send} disabled={late || text.trim().length < 3} className="px-2 rounded border disabled:opacity-40" style={{ borderColor: `${HOT}88`, color: HOT }} aria-label="Inject event"><Zap className="w-3.5 h-3.5" /></button>
      </div>
      {msg && <p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">{msg}</p>}
    </Section>
  );
}

function DebateFeed({ s }: { s: RunState }) {
  const [limit, setLimit] = useState(30);
  const names = useMemo(() => new Map(s.agents.map(a => [a.id, a])), [s.agents]);
  const prevOf = useMemo(() => {
    const m = new Map<string, Post>();
    const prev = new Map<string, number>();
    for (const p of s.posts) { const before = m.get(p.agent); if (before) prev.set(p.id, before.probability); m.set(p.agent, p); }
    return prev;
  }, [s.posts]);
  type Item = { kind: 'post'; post: Post } | { kind: 'inject'; text: string; round: number } | { kind: 'round'; round: number; consensus: number };
  const items: Item[] = [];
  let pi = 0;
  const injects = s.injects.slice();
  for (let r = 1; r <= Math.max(s.roundsPlanned, 1); r++) {
    for (const inj of injects.filter(x => x.round === r)) items.push({ kind: 'inject', text: inj.text, round: r });
    while (pi < s.posts.length && s.posts[pi].round === r) items.push({ kind: 'post', post: s.posts[pi++] });
    const stat = s.rounds.find(x => x.round === r);
    if (stat) items.push({ kind: 'round', round: r, consensus: stat.consensus });
  }
  while (pi < s.posts.length) items.push({ kind: 'post', post: s.posts[pi++] });
  const shown = items.reverse().slice(0, limit);

  if (!s.agents.length) {
    return (
      <Section title="THE DEBATE">
        <p className="text-[10px] text-[var(--text-muted)]">{s.status === 'running' ? 'The panel is being assembled. Watch the globe: actors and their relations are drawing in.' : 'No debate.'}</p>
        {s.context.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[9px] font-mono tracking-[0.18em] text-[var(--text-muted)]">READING {s.context.length} LIVE ITEMS</div>
            {s.context.slice(0, 6).map(c => <p key={c.id} className="text-[10px] text-[var(--text-secondary)] truncate">· {c.title}</p>)}
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section title="THE DEBATE" right={<span className="text-[9px] font-mono text-[var(--text-muted)]">{s.posts.length} posts</span>}>
      <div className="flex flex-col gap-2.5">
        {shown.map((it, i) => {
          if (it.kind === 'round') {
            return <div key={`r${it.round}`} className="flex items-center gap-2 text-[9px] font-mono text-[var(--text-muted)]"><span className="flex-1 h-px bg-white/[0.06]" />ROUND {it.round} · CONSENSUS {pct(it.consensus)}<span className="flex-1 h-px bg-white/[0.06]" /></div>;
          }
          if (it.kind === 'inject') {
            return <div key={`i${i}`} className="rounded-md px-2.5 py-1.5 text-[10px]" style={{ background: `${HOT}14`, border: `1px solid ${HOT}44`, color: '#FFD6F1' }}><Zap className="w-3 h-3 inline mr-1" />Injected before round {it.round}: {it.text}</div>;
          }
          const p = it.post;
          const a = names.get(p.agent);
          const before = prevOf.get(p.id);
          const delta = before !== undefined ? Math.round((p.probability - before) * 100) : null;
          return (
            <div key={p.id} className="flex gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-black flex-shrink-0" style={{ background: leanColor(p.probability) }}>{initials(a?.name ?? '?')}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-[var(--text-primary)] font-medium truncate">{a?.name ?? p.agent}</span>
                  <span className="text-[var(--text-muted)] truncate">{a?.role}</span>
                  <span className="ml-auto font-mono text-white tabular-nums">{pct(p.probability)}</span>
                  {delta !== null && delta !== 0 && <span className="font-mono text-[9px]" style={{ color: delta > 0 ? HOT : '#6E8BFF' }}>{delta > 0 ? '+' : ''}{delta}</span>}
                </div>
                <p className="text-[10px] text-[var(--text-secondary)] leading-snug mt-0.5">{p.text}</p>
                {p.replies.map((r, j) => (
                  <p key={j} className="text-[9px] text-[var(--text-muted)] mt-0.5">
                    ↳ <span style={{ color: r.stance === 'agree' ? ACCENT : r.stance === 'disagree' ? HOT : undefined }}>{r.stance}s</span> with {names.get(r.to)?.name ?? r.to}{r.point && <>: “{r.point}”</>}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
        {items.length > limit && <button onClick={() => setLimit(l => l + 30)} className="text-[10px] text-[var(--text-muted)] hover:text-white">show earlier</button>}
      </div>
    </Section>
  );
}

function PanelList({ s, selected, onLocate }: { s: RunState; selected: string | null; onLocate: Props['onLocate'] }) {
  const latest = latestPosts(s);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selected?.startsWith('g:')) refs.current.get(selected.slice(2))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!s.agents.length) return null;
  return (
    <Section title={`THE PANEL · ${s.agents.length}`} right={<span className="text-[8px] font-mono text-[var(--text-muted)]"><span style={{ color: '#6E8BFF' }}>NO</span> ← → <span style={{ color: HOT }}>YES</span></span>}>
      <div className="flex flex-col">
        {s.agents.map(a => {
          const p = latest.get(a.id)?.probability ?? null;
          const thinking = a.id in s.thinking;
          const sel = selected === `g:${a.id}`;
          return (
            <button key={a.id} ref={el => { if (el) refs.current.set(a.id, el); }}
              onClick={() => a.lat !== null && a.lng !== null && onLocate(a.lat, a.lng, 3.5)}
              className={`flex items-center gap-2 px-1.5 py-1 rounded text-left transition-colors ${sel ? 'bg-white/10' : 'hover:bg-white/[0.04]'}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: leanColor(p), boxShadow: thinking ? `0 0 8px ${ACCENT}` : undefined }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] text-[var(--text-primary)] truncate">{a.name}</span>
                <span className="block text-[9px] text-[var(--text-muted)] truncate">{a.role}{a.place && ` · ${a.place}`}</span>
              </span>
              {thinking ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: ACCENT }} /> : <span className="text-[10px] font-mono text-white tabular-nums">{pct(p)}</span>}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function AskPanel({ s, oai, engine, keyValue, ready, selected }: { s: RunState; oai: OaiClient; engine: Engine; keyValue: string; ready: boolean; selected: string | null }) {
  const [target, setTarget] = useState('report');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ who: string; text: string; you: boolean }[]>([]);
  // A panelist clicked on the globe becomes the one you are talking to.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (selected?.startsWith('g:')) setTarget(selected.slice(2));
  }
  const targetName = target === 'report' ? 'Report agent' : s.agents.find(a => a.id === target)?.name ?? target;
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
  return (
    <Section title="QUESTION THE PANEL" right={<MessageSquare className="w-3 h-3 text-[var(--text-muted)]" />}>
      <select value={target} onChange={e => setTarget(e.target.value)}
        className="w-full bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] focus:outline-none">
        <option value="report" disabled={!s.report}>Report agent{!s.report ? ' (after the report)' : ''}</option>
        {s.agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
      </select>
      {log.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5 max-h-64 overflow-y-auto styled-scrollbar">
          {log.map((m, i) => (
            <div key={i} className={`rounded-md px-2 py-1.5 text-[10px] leading-snug ${m.you ? 'bg-white/[0.05] text-[var(--text-primary)] ml-6' : 'text-[var(--text-secondary)] mr-2'}`} style={!m.you ? { background: `${ACCENT}12`, border: `1px solid ${ACCENT}30` } : undefined}>
              <span className="block text-[8px] font-mono tracking-wider text-[var(--text-muted)] mb-0.5">{m.who.toUpperCase()}</span>
              <span className="whitespace-pre-wrap">{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <input value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} onKeyDown={e => e.key === 'Enter' && send()} disabled={!ready || (target === 'report' && !s.report)}
          placeholder={!ready ? 'Add your key to ask' : `Ask ${targetName.split(' ')[0]}…`}
          className="flex-1 bg-black/40 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] disabled:opacity-50" />
        <button onClick={send} disabled={!ready || busy || !message.trim()} className="px-2 rounded border disabled:opacity-40" style={{ borderColor: `${ACCENT}88`, color: ACCENT }} aria-label="Send">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </Section>
  );
}

function UsageLine({ s }: { s: RunState }) {
  const tokens = s.usage.input + s.usage.output;
  return (
    <div className="px-1 text-[9px] font-mono text-[var(--text-muted)] flex flex-wrap gap-x-2">
      <span>{s.provider} / {s.model}</span>
      <span>{s.usage.calls} calls</span>
      {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
      {s.warnings.length > 0 && <span title={s.warnings.join('\n')} className="text-[#FFB020]">{s.warnings.length} hiccup{s.warnings.length === 1 ? '' : 's'}</span>}
    </div>
  );
}

function HistoryList({ oai, onPick }: { oai: OaiClient; onPick: (id: string) => void }) {
  if (!oai.history.length) {
    return <Section title="YOUR FORECASTS"><p className="text-[10px] text-[var(--text-muted)]">Nothing yet. Forecasts you run are listed here, in this browser only. The server keeps a run for a few hours.</p></Section>;
  }
  return (
    <Section title="YOUR FORECASTS">
      <div className="flex flex-col">
        {oai.history.map(h => (
          <div key={h.id} className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
            <button onClick={() => onPick(h.id)} className="flex-1 min-w-0 text-left group">
              <span className="block text-[10px] text-[var(--text-primary)] group-hover:text-white truncate">{h.question}</span>
              <span className="block text-[9px] font-mono text-[var(--text-muted)]">{new Date(h.at).toLocaleString()} · {h.status}</span>
            </button>
            <span className="text-[11px] font-mono text-white tabular-nums">{pct(h.probability)}</span>
            <button onClick={() => oai.forget(h.id)} className="text-[var(--text-muted)] hover:text-[var(--alert-red)]" aria-label="Remove from history"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}
