'use client';
/**
 * OSIRIS OSI: a run at a glance: where it is, its controls, and the verdict
 * so far with how it got there.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Camera, Check, Crosshair, Square, Zap } from 'lucide-react';
import type { OsiClient } from '@/lib/osi/client';
import { currentAnswer, type RunState } from '@/lib/osi/state';
import { formatAmount, leader, outcomeColor, positionIn } from '@/lib/osi/forecast';
import { KIND_LABEL, LABEL, T, fit, gold, pct, smooth } from './theme';
import { Overline, TextButton } from './atoms';

const PHASES: { id: RunState['phase']; label: string }[] = [
  { id: 'context', label: 'Feeds' },
  { id: 'graph', label: 'World' },
  { id: 'agents', label: 'Panel' },
  { id: 'simulate', label: 'Debate' },
  { id: 'report', label: 'Report' },
];

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

/** The run's five stages as one connected line. */
export function PhaseRail({ s }: { s: RunState }) {
  const at = s.status === 'done' ? PHASES.length : PHASES.findIndex(p => p.id === s.phase);
  const inset = 16;
  return (
    <div className="relative w-full px-3">
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

export function StatusLine({ s }: { s: RunState }) {
  if (s.status === 'running') {
    const thinking = Object.keys(s.thinking).length;
    return (
      <p role="status" className="flex items-center gap-2 text-[11px] min-w-0 text-[var(--text-secondary)]">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[var(--alert-green)] animate-osiris-pulse" />
        <span className="truncate min-w-0">{s.phaseLabel || 'Starting'}</span>
        {thinking > 0 && <span className="whitespace-nowrap font-mono text-[9.5px] tracking-[0.1em] text-[var(--cyan-primary)]">{thinking} THINKING</span>}
      </p>
    );
  }
  if (s.status === 'failed') return <p role="status" className="text-[11px] text-[var(--alert-red)] truncate">{s.message || 'The run failed.'}</p>;
  if (s.status === 'cancelled') return <p role="status" className="text-[11px] text-[var(--text-muted)]">Stopped.</p>;
  return <p role="status" className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"><Check className="w-3.5 h-3.5 text-[var(--alert-green)]" /> Forecast complete</p>;
}

export function Controls({ s, osi, focus, onFocus, following, onFollow }: { s: RunState; osi: OsiClient; focus?: boolean; onFocus?: () => void; following?: boolean; onFollow?: () => void }) {
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

export function RunHead({ s, osi, focus, onFocus, following, onFollow }: { s: RunState; osi: OsiClient; focus?: boolean; onFocus?: () => void; following?: boolean; onFollow?: () => void }) {
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

/* ───────────── The verdict ───────────── */

export function Verdict({ s, large = false }: { s: RunState; large?: boolean }) {
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
    <section className="flex flex-col gap-3.5" aria-label="Forecast">
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <Overline>{caption}</Overline>
          <div className={`mt-1 flex items-baseline gap-1 font-mono font-light tabular-nums tracking-[-0.02em] ${large ? 'text-[48px] leading-[0.95]' : 'text-[42px] leading-none'}`}
            style={{ color: T.heading, textShadow: `0 0 22px ${gold(0.25)}` }}>
            {shown === null ? <span className="text-[var(--text-muted)]">—</span> : <>{format(shown)}<span className={`${large ? 'text-[20px]' : 'text-[18px]'} text-[var(--gold-primary)]`}>{suffix}</span></>}
          </div>
          {sub && <p className="mt-1 text-[11.5px] truncate text-[var(--text-secondary)]">{sub}</p>}
        </div>
        <Trajectory s={s} width={large ? 140 : 128} />
      </div>
      {detail}
    </section>
  );
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

/* ───────────── Steering and accounting ───────────── */

export function InjectBox({ osi, s }: { osi: OsiClient; s: RunState }) {
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
      {msg && <p role="status" className="mt-1.5 text-[10.5px] text-[var(--text-secondary)]">{msg}</p>}
    </div>
  );
}

export function UsageLine({ s }: { s: RunState }) {
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
