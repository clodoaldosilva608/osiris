'use client';
/**
 * OSIRIS OI: the execution trace.
 *
 * The run as the engine ran it: each step with its state, how long it took
 * (live, for the one under way), the engine's own words for it and what it
 * produced. Steps not reached yet are listed, so the whole plan shows from
 * the first event.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Minus, X } from 'lucide-react';
import { formatDuration, traceOf, type TraceStep } from '@/lib/oi/trace';
import type { RunState } from '@/lib/oi/state';
import { LABEL, T, cyan, gold } from './theme';
import { SectionTitle } from './atoms';

function StepIcon({ status }: { status: TraceStep['status'] }) {
  const box = 'w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 border relative z-10';
  if (status === 'done') return <span className={box} style={{ borderColor: T.gold, background: gold(0.14), color: T.gold }}><Check className="w-2.5 h-2.5" strokeWidth={3} /></span>;
  if (status === 'active') return <span className={box} style={{ borderColor: T.cyan, background: cyan(0.12), color: T.cyan }}><Loader2 className="w-2.5 h-2.5 animate-spin" strokeWidth={3} /></span>;
  if (status === 'failed') return <span className={box} style={{ borderColor: T.red, background: 'rgba(255,61,61,0.12)', color: T.red }}><X className="w-2.5 h-2.5" strokeWidth={3} /></span>;
  if (status === 'skipped') return <span className={box} style={{ borderColor: 'var(--border-primary)', color: T.mute }}><Minus className="w-2.5 h-2.5" /></span>;
  return <span className={box} style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }} />;
}

export function TraceView({ s }: { s: RunState }) {
  const steps = useMemo(() => traceOf(s), [s]);
  // The step under way shows its time ticking.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [s.status]);

  const total = s.startedAt ? (s.endedAt || (s.status === 'running' ? now : s.updatedAt)) - s.startedAt : 0;
  const tokens = s.usage.input + s.usage.output;

  return (
    <section aria-label="Execution trace">
      <SectionTitle right={<span className="text-[9px] font-mono tabular-nums tracking-[0.06em] text-[var(--text-muted)]">{formatDuration(total)}</span>}>Execution</SectionTitle>
      <ol className="relative flex flex-col">
        {steps.map((st, i) => {
          const running = st.status === 'active';
          const duration = st.start !== null ? (st.end ?? now) - st.start : null;
          const quiet = st.status === 'pending' || st.status === 'skipped';
          return (
            <li key={st.id} className="relative flex gap-3 pb-3.5 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-[8.5px] top-[18px] bottom-0 w-px" style={{ background: st.status === 'done' ? gold(0.45) : 'var(--border-secondary)' }} />}
              <StepIcon status={st.status} />
              <div className="flex-1 min-w-0 -mt-px">
                <div className="flex items-baseline gap-2">
                  <span className={`flex-1 text-[11.5px] font-semibold truncate ${quiet ? 'text-[var(--text-muted)]' : 'text-[var(--text-heading)]'}`}>{st.title}</span>
                  <span className={`text-[9.5px] font-mono tabular-nums flex-shrink-0 ${running ? 'text-[var(--cyan-primary)]' : 'text-[var(--text-muted)]'}`}>
                    {duration !== null ? formatDuration(duration) : st.status === 'skipped' ? 'not reached' : 'pending'}
                  </span>
                </div>
                {st.detail && !quiet && <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-secondary)] truncate">{st.detail}</p>}
                {st.metrics.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {st.metrics.map(m => (
                      <span key={m.label} className="inline-flex items-center gap-1.5 h-[18px] px-1.5 rounded border border-[var(--border-secondary)] bg-white/[0.02]">
                        <span className={`${LABEL} !text-[7.5px] !tracking-[0.14em] text-[var(--text-muted)]`}>{m.label}</span>
                        <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)]">{m.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {[['Model calls', String(s.usage.calls)], ['Tokens', tokens ? tokens.toLocaleString() : '—'], ['Engine', s.provider || '—']].map(([k, v]) => (
          <div key={k} className="rounded-md border border-[var(--border-secondary)] bg-white/[0.02] px-2.5 py-1.5 min-w-0">
            <div className={`${LABEL} !text-[7.5px] text-[var(--text-muted)]`}>{k}</div>
            <div className="mt-0.5 text-[11px] font-mono tabular-nums truncate text-[var(--text-primary)]" title={k === 'Engine' ? `${s.provider} / ${s.model}` : undefined}>{v}</div>
          </div>
        ))}
      </div>
      {s.warnings.length > 0 && (
        <div className="mt-3 rounded-md border px-2.5 py-2" style={{ borderColor: 'rgba(255,149,0,0.25)', background: 'rgba(255,149,0,0.05)' }}>
          <div className={`${LABEL} !text-[8px] text-[var(--alert-orange)]`}>{s.warnings.length} hiccup{s.warnings.length === 1 ? '' : 's'} along the way</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {s.warnings.slice(-4).map((w, i) => <li key={i} className="text-[10px] leading-snug text-[var(--text-secondary)] truncate" title={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
