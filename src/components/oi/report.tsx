'use client';
/**
 * OSIRIS OI: the report agent's forecast: headline, drivers, scenarios,
 * signposts and dissent, every part of it a way into the research.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Check, Copy, Download } from 'lucide-react';
import { toMarkdown } from '@/lib/oi/client';
import { directionWord } from '@/lib/oi/forecast';
import type { RunState } from '@/lib/oi/state';
import { T, leanTo, pct } from './theme';
import { Mentions, Overline, SectionTitle, TextButton } from './atoms';

export function ReportBody({ s, runId, selected, onSelect }: { s: RunState; runId: string | null; selected: string | null; onSelect: (k: string | null) => void }) {
  const r = s.report!;
  const frame = s.frame;
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' && runId ? `${window.location.origin}/?oi=${runId}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const blob = new Blob([toMarkdown(s, url)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `osiris-oi-${(runId ?? 'forecast').slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const conf = { low: 'gotham-tag--high', medium: 'gotham-tag--medium', high: 'gotham-tag--low' }[r.confidence];

  return (
    <section className="flex flex-col gap-5" aria-label="Report">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Overline color={T.gold}>Report</Overline>
          <div className="ml-auto flex items-center -mr-2">
            <TextButton onClick={copy} title="Copy a link that replays this run">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Link</TextButton>
            <TextButton onClick={download} title="Download the forecast as Markdown"><Download className="w-3 h-3" /> Export</TextButton>
          </div>
        </div>
        <h3 className="text-[14px] font-semibold leading-snug text-[var(--text-heading)]">{r.headline}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`gotham-tag ${conf}`}>{r.confidence} confidence</span>
          {frame?.kind === 'binary' && <span className="text-[9.5px] font-mono tracking-[0.1em] text-[var(--text-muted)]">PANEL {pct(r.swarm)} · REPORT {pct(r.probability)}</span>}
        </div>
        {r.deviation && <p className="mt-2 text-[11px] italic leading-relaxed text-[var(--text-muted)]">{r.deviation}</p>}
        <p className="mt-2.5 text-[11.5px] leading-[1.65] text-[var(--text-secondary)]"><Mentions text={r.summary} s={s} onSelect={onSelect} /></p>
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
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-secondary)]"><Mentions text={r.dissent} s={s} onSelect={onSelect} /></p>
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
