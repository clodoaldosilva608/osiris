/**
 * OSIRIS — Markets panel helpers.
 *
 * The pure pieces of the Markets & Intel panel, kept out of the component so
 * they can be tested: which benchmarks lead the Pulse strip, how a month's
 * move and a section's move are measured, how a move is coloured on the
 * heatmap, and how the watchlist is stored.
 */

export interface MarketQuote {
  name: string;
  symbol: string;
  price: number;
  change_percent: number;
  up: boolean;
  spark?: number[];
  currency?: string;
  market_open?: boolean;
}

/**
 * The benchmarks the Pulse strip leads with, in reading order: US equities and
 * fear, rates and the dollar, then gold, oil and bitcoin.
 */
export const PULSE: ReadonlyArray<{ symbol: string; label: string }> = [
  { symbol: 'ES=F', label: 'S&P 500' },
  { symbol: 'NQ=F', label: 'NASDAQ' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: '^TNX', label: 'US 10Y' },
  { symbol: 'DX-Y.NYB', label: 'DOLLAR' },
  { symbol: 'GC=F', label: 'GOLD' },
  { symbol: 'CL=F', label: 'WTI' },
  { symbol: 'BTC-USD', label: 'BITCOIN' },
];

/** Percentage move across the sparkline window — a month of daily closes. */
export function monthChange(spark?: number[]): number | null {
  if (!spark || spark.length < 2) return null;
  const first = spark[0];
  const last = spark[spark.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

/** The mean daily move of a section, for its chip. Null when it has no quotes. */
export function averageMove(quotes: MarketQuote[]): number | null {
  const moves = quotes.map(q => q.change_percent).filter(Number.isFinite);
  if (!moves.length) return null;
  return moves.reduce((sum, m) => sum + m, 0) / moves.length;
}

/**
 * Heatmap colour for a move: green up, red down, stronger with size, and
 * saturating at ±`cap`% so one wild instrument doesn't wash out the rest — a
 * quiet day reads quiet, and a 3% day is as loud as a 10% one.
 */
export function heat(pct: number, cap = 3): { background: string; border: string } {
  const strength = Number.isFinite(pct) ? Math.min(Math.abs(pct) / cap, 1) : 0;
  const rgb = pct >= 0 ? '0,230,118' : '255,61,61';
  return {
    background: `rgba(${rgb},${(0.05 + strength * 0.35).toFixed(3)})`,
    border: `rgba(${rgb},${(0.15 + strength * 0.45).toFixed(3)})`,
  };
}

/** "+1.23%", "−0.40%" (a real minus), or "—" for no reading. */
export function formatMove(pct: number | null | undefined, digits = 2): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const fixed = Math.abs(pct).toFixed(digits);
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%`;
  return `${pct > 0 ? '+' : '−'}${fixed}%`;
}

/* ── watchlist ───────────────────────────────────────────────── */

export const WATCHLIST_KEY = 'osiris.markets.watchlist';
export const WATCHLIST_CAP = 30;

/** Yahoo symbols: letters, digits and ^ = . - (e.g. ^VIX, ES=F, DX-Y.NYB). */
const SYMBOL = /^[\w^=.-]{1,20}$/;

/** Tolerates anything localStorage might hand back, including nothing. */
export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const s of value) if (typeof s === 'string' && SYMBOL.test(s)) seen.add(s);
    return [...seen].slice(0, WATCHLIST_CAP);
  } catch {
    return [];
  }
}

/** Star or unstar a symbol; newest stars go last, so the list keeps its order. */
export function toggleWatch(list: string[], symbol: string): string[] {
  if (list.includes(symbol)) return list.filter(s => s !== symbol);
  if (!SYMBOL.test(symbol)) return list;
  return [...list, symbol].slice(-WATCHLIST_CAP);
}
