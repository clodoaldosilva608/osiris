/**
 * OSIRIS OI: the panel's design tokens.
 *
 * OI wears the platform's theme through its CSS variables, so it is gold and
 * cyan in Core and violet in Ghost. The only colours of its own are the three
 * line colours, which are the arcs' and are set in the Style Studio.
 */
import type { Frame, Link } from '@/lib/oi/types';
import { outcomeColor } from '@/lib/oi/forecast';

export const T = {
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
  support: 'var(--map-oi-support, #b388ff)',
  oppose: 'var(--map-oi-oppose, #ff5ccb)',
  neutral: 'var(--map-oi-neutral, #8c7cff)',
};

export const gold = (a: number) => `rgba(var(--gold-rgb),${a})`;
export const cyan = (a: number) => `rgba(var(--cyan-rgb),${a})`;
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
export const toneColor = (tone: Link['tone']) => (tone === 'support' ? T.support : tone === 'oppose' ? T.oppose : T.neutral);

/** Toward YES (or higher) in gold, toward NO (or lower) in cyan; a choice in its outcome's colour. */
export const leanTo = (frame: Frame | null, push: 'yes' | 'no', favors = '') =>
  frame?.kind === 'choice' && favors ? outcomeColor(Math.max(0, frame.outcomes.indexOf(favors))) : push === 'yes' ? T.gold : T.cyan;

/** The HUD's small label: mono, spaced, upper case. */
export const LABEL = 'text-[9px] font-mono tracking-[0.18em] uppercase';
export const FIELD = 'w-full bg-black/40 border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] transition-colors';
/** A surface laid over the busy globe or graph: the theme's panel colour, solid. */
export const SOLID = 'var(--bg-panel-solid)';

export const pct = (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`);
export const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const shortName = (name: string) => name.replace(' (Alibaba Cloud)', '').replace(' (scripted, dev only)', '');

export const KIND_LABEL: Record<Frame['kind'], string> = { binary: 'Yes / no', choice: 'Which outcome', number: 'How much' };
export const KIND_SHORT: Record<Frame['kind'], string> = { binary: 'Yes / no', choice: 'Which', number: 'How much' };

export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** A window around some values, at least `min` wide, so small moves still read as moves. */
export function fit(vals: number[], min: number): [number, number] {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const half = Math.max(min, (hi - lo) * 1.2) / 2;
  return [(lo + hi) / 2 - half, (lo + hi) / 2 + half];
}

/** A smooth line through points, for trajectories and sparklines. */
export function smooth(points: [number, number][]): string {
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
