/**
 * OSIRIS OSI: the run's execution trace.
 *
 * What the engine did, step by step, with when and how long: read the feeds,
 * map the world, assemble the panel, each round of debate, write the report.
 * Steps the run has not reached yet are listed as pending, so the trace reads
 * as the whole plan from the first event. Every figure comes from the run's
 * own events; nothing here is estimated.
 */
import type { RunState } from './state';
import type { Phase } from './types';
import { formatAmount, leader } from './forecast';

export type StepStatus = 'done' | 'active' | 'pending' | 'failed' | 'skipped';

export interface TraceMetric { label: string; value: string }

export interface TraceStep {
  /** 'context', 'graph', 'agents', 'round:<n>' or 'report'. */
  id: string;
  phase: Phase;
  title: string;
  /** The engine's own words for the step, once it has started it. */
  detail: string;
  status: StepStatus;
  start: number | null;
  end: number | null;
  metrics: TraceMetric[];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** A duration in the trace's terms: tenths of a second, then minutes. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

export function traceOf(s: RunState): TraceStep[] {
  const planned: { id: string; phase: Phase; title: string }[] = [
    { id: 'context', phase: 'context', title: 'Read live intelligence' },
    { id: 'graph', phase: 'graph', title: 'Map the world' },
    { id: 'agents', phase: 'agents', title: 'Assemble the panel' },
    ...Array.from({ length: Math.max(1, s.roundsPlanned) }, (_, i) => ({ id: `round:${i + 1}`, phase: 'simulate' as Phase, title: `Debate · round ${i + 1}` })),
    { id: 'report', phase: 'report', title: 'Write the forecast' },
  ];

  // The engine announces each stage as it enters it; the k-th "simulate" is round k.
  const seen = new Map<string, { label: string; at: number; index: number }>();
  let round = 0;
  s.steps.forEach((st, index) => {
    const id = st.phase === 'simulate' ? `round:${++round}` : st.phase;
    if (st.phase !== 'done') seen.set(id, { label: st.label, at: st.at, index });
  });

  const ended = s.status !== 'running';
  return planned.map(p => {
    const hit = seen.get(p.id);
    const next = hit ? s.steps[hit.index + 1] : undefined;
    const start = hit?.at ?? null;
    const end = hit ? (next?.at ?? (ended ? s.endedAt || s.updatedAt : null)) : null;
    let status: StepStatus;
    if (!hit) status = ended ? 'skipped' : 'pending';
    else if (next) status = 'done';
    else if (!ended) status = 'active';
    else status = s.status === 'done' ? 'done' : 'failed';
    return { id: p.id, phase: p.phase, title: p.title, detail: hit?.label ?? '', status, start, end, metrics: hit ? metricsFor(s, p.id) : [] };
  });
}

function metricsFor(s: RunState, id: string): TraceMetric[] {
  const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
  switch (id) {
    case 'context': {
      const kinds = (['news', 'quake', 'market'] as const).map(k => [k, count(s.context, c => c.kind === k)] as const).filter(([, n]) => n > 0);
      return [{ label: 'Sources', value: String(s.context.length) }, ...kinds.map(([k, n]) => ({ label: k === 'news' ? 'News' : k === 'quake' ? 'Quakes' : 'Markets', value: String(n) }))];
    }
    case 'graph': {
      const out: TraceMetric[] = [
        { label: 'Actors', value: String(s.actors.length) },
        { label: 'Relations', value: String(count(s.links, l => l.kind === 'relation')) },
        { label: 'Evidence', value: String(count(s.links, l => l.kind === 'evidence')) },
      ];
      const f = s.frame;
      if (f?.kind === 'binary') out.push({ label: 'Base rate', value: pct(f.baseRate) });
      if (f?.kind === 'choice') out.push({ label: 'Outcomes', value: String(f.outcomes.length) });
      if (f?.kind === 'number' && f.anchor !== null) out.push({ label: 'Today', value: formatAmount(f.anchor) });
      return out;
    }
    case 'agents':
      return [{ label: 'Panelists', value: s.agentsPlanned ? `${s.agents.length} / ${s.agentsPlanned}` : String(s.agents.length) }];
    case 'report': {
      const r = s.report;
      if (!r) return [];
      return [
        { label: 'Confidence', value: r.confidence },
        { label: 'Scenarios', value: String(r.scenarios.length) },
        { label: 'Signposts', value: String(r.signposts.length) },
      ];
    }
  }
  const round = Number(id.slice(6));
  const posts = s.posts.filter(p => p.round === round);
  const out: TraceMetric[] = [
    { label: 'Turns', value: s.agents.length ? `${posts.length} / ${s.agents.length}` : String(posts.length) },
    { label: 'Replies', value: String(posts.reduce((n, p) => n + p.replies.length, 0)) },
  ];
  const injects = count(s.injects, x => x.round === round);
  if (injects) out.push({ label: 'Injected', value: String(injects) });
  const stat = s.rounds.find(r => r.round === round);
  if (stat) {
    if (s.frame?.kind === 'number' && stat.value) out.push({ label: 'Median', value: formatAmount(stat.value.median) });
    else if (s.frame?.kind === 'choice' && stat.shares) {
      const i = leader(stat.shares);
      out.push({ label: 'Leads', value: `${s.frame.outcomes[i] ?? '—'} ${pct(stat.shares[i])}` });
    } else out.push({ label: 'Consensus', value: pct(stat.consensus) }, { label: 'Spread', value: `${pct(stat.p25)}–${pct(stat.p75)}` });
  }
  return out;
}

/** How far through the plan the run is, 0..1, for a progress line. */
export function progressOf(steps: TraceStep[]): number {
  if (!steps.length) return 0;
  const done = steps.filter(st => st.status === 'done' || st.status === 'failed').length;
  const active = steps.some(st => st.status === 'active') ? 0.5 : 0;
  return Math.min(1, (done + active) / steps.length);
}
