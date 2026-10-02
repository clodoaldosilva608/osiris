/**
 * OSIRIS OI: the debate over time.
 *
 * One lane per panelist, one column per round, each cell the view that
 * panelist gave in that round and how far it moved; above them, the panel's
 * pooled view round by round, its spread, and the report's final word. Every
 * value is put on one 0..1 scale so lanes and chart line up whatever the
 * question asks: a probability as itself, a choice as the share given to the
 * outcome that ended up leading, a number by where it falls in the run's range.
 */
import type { RunState } from './state';
import type { Post } from './types';
import { formatAmount, leader, positionIn, postView } from './forecast';

export interface TimelineCell {
  round: number;
  post: Post;
  /** 0..1 on the timeline's scale. */
  value: number;
  label: string;
  /** Change since this panelist's previous round, on the same scale; null for their first. */
  delta: number | null;
}

export interface TimelineLane {
  key: string;
  name: string;
  role: string;
  /** One per round, null where they did not speak. */
  cells: (TimelineCell | null)[];
  /** First to last, on the scale. */
  drift: number | null;
}

export interface TimelinePoint { value: number; low: number | null; high: number | null; label: string }

export interface Timeline {
  rounds: number[];
  lanes: TimelineLane[];
  /** The panel's pooled view after each round, or null for a round not yet pooled. */
  pooled: (TimelinePoint | null)[];
  /** The report's figure, once written. */
  final: TimelinePoint | null;
  /** The base rate, or today's value for a number, on the scale. */
  reference: { value: number; label: string } | null;
  injects: { round: number; text: string }[];
  /** What the scale means at its two ends. */
  ends: [string, string];
  /** A point on the scale in the question's own terms: a percentage, or an amount. */
  label: (v: number) => string;
}

export function timelineOf(s: RunState): Timeline {
  const frame = s.frame;
  const n = Math.max(s.roundsPlanned, s.rounds.length, ...s.posts.map(p => p.round), 1);
  const rounds = Array.from({ length: n }, (_, i) => i + 1);
  const [lo, hi] = rangeOf(s);
  const leadShares = s.report?.shares ?? s.rounds[s.rounds.length - 1]?.shares;
  const lead = leadShares ? leader(leadShares) : 0;

  const scale = (p: Post): number => {
    if (frame?.kind === 'number') return positionIn(p.estimate?.value ?? NaN, lo, hi);
    if (frame?.kind === 'choice') return p.shares?.[lead] ?? 0;
    return p.probability;
  };
  const toScale = (v: number) => (frame?.kind === 'number' ? positionIn(v, lo, hi) : v);

  const lanes: TimelineLane[] = s.agents.map(a => {
    let prev: number | null = null;
    const cells = rounds.map(r => {
      const post = s.posts.find(p => p.agent === a.id && p.round === r);
      if (!post) return null;
      const value = scale(post);
      // A number's cell carries the estimate alone; its range is in the panelist's view.
      const label = frame?.kind === 'number' && post.estimate ? formatAmount(post.estimate.value) : postView(post, frame);
      const cell: TimelineCell = { round: r, post, value, label, delta: prev === null ? null : value - prev };
      prev = value;
      return cell;
    });
    const spoken = cells.filter((c): c is TimelineCell => c !== null);
    return {
      key: `g:${a.id}`, name: a.name, role: a.role, cells,
      drift: spoken.length > 1 ? spoken[spoken.length - 1].value - spoken[0].value : null,
    };
  });

  const pooled = rounds.map(r => {
    const st = s.rounds.find(x => x.round === r);
    if (!st) return null;
    if (frame?.kind === 'number' && st.value) {
      return { value: toScale(st.value.median), low: toScale(st.value.p25), high: toScale(st.value.p75), label: formatAmount(st.value.median) };
    }
    if (frame?.kind === 'choice' && st.shares) {
      return { value: st.shares[lead] ?? 0, low: null, high: null, label: `${frame.outcomes[lead] ?? ''} ${Math.round((st.shares[lead] ?? 0) * 100)}%`.trim() };
    }
    return { value: st.consensus, low: st.p25, high: st.p75, label: `${Math.round(st.consensus * 100)}%` };
  });

  let final: TimelinePoint | null = null;
  const r = s.report;
  if (r) {
    if (frame?.kind === 'number' && r.estimate) final = { value: toScale(r.estimate.value), low: toScale(r.estimate.low), high: toScale(r.estimate.high), label: formatAmount(r.estimate.value) };
    else if (frame?.kind === 'choice' && r.shares) final = { value: r.shares[lead] ?? 0, low: null, high: null, label: `${frame.outcomes[lead] ?? ''} ${Math.round((r.shares[lead] ?? 0) * 100)}%`.trim() };
    else final = { value: r.probability, low: null, high: null, label: `${Math.round(r.probability * 100)}%` };
  }

  const reference = frame?.kind === 'binary' ? { value: frame.baseRate, label: `Base rate ${Math.round(frame.baseRate * 100)}%` }
    : frame?.kind === 'number' && frame.anchor !== null ? { value: toScale(frame.anchor), label: `Today ${formatAmount(frame.anchor)}` }
      : null;

  const ends: [string, string] = frame?.kind === 'number' ? [formatAmount(lo), formatAmount(hi)]
    : frame?.kind === 'choice' ? ['0%', `${frame.outcomes[lead] ?? 'Leader'} 100%`] : ['NO', 'YES'];

  const label = frame?.kind === 'number' ? (v: number) => formatAmount(lo + v * (hi - lo)) : (v: number) => `${Math.round(v * 100)}%`;
  return { rounds, lanes, pooled, final, reference, injects: s.injects, ends, label };
}

/** A number question's range: every estimate in every round, the pooled spreads, the report's range and today's value. */
export function rangeOf(s: RunState): [number, number] {
  const vals = [
    ...s.posts.map(p => p.estimate?.value),
    ...s.rounds.flatMap(st => (st.value ? [st.value.p25, st.value.p75] : [])),
    s.report?.estimate?.low, s.report?.estimate?.high,
    s.frame?.anchor ?? undefined,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return [0, 1];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi > lo) return [lo, hi];
  const pad = Math.abs(lo) * 0.05 || 1;
  return [lo - pad, hi + pad];
}
