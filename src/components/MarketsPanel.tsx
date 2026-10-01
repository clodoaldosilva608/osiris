'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Star } from 'lucide-react';
import AiOverview from './AiOverview';
import DonBotScan from './DonBotScan';
import {
  FUNCTIONS, PULSE, WEI_REGIONS,
  exchangeClocks, formatMove, formatNet, formatPrice, formatVolume, heat, longName, monthChange,
  netChange, parseCommand, parseWatchlist, rangePosition, sortQuotes, suggest, toggleWatch, tradeTime,
  WATCHLIST_KEY,
  type FunctionCode, type MarketQuote as Quote, type SortKey, type Suggestion,
} from '@/lib/markets';

/**
 * OSIRIS — the markets terminal.
 *
 * Laid out the way a market terminal is: black, amber, monospaced, one number
 * to a cell. Driven from a command line — a ticker, a function code or a
 * function key's number, then GO — or from the numbered keys under it. One
 * monitor table serves every function, and it widens to more columns as the
 * panel does: price and move when docked; net change, day range, 52-week
 * position, last trade and volume in full screen.
 *
 * Nothing here costs a request of its own: every column comes from the one
 * quote per instrument the feed already fetches.
 */

// Canvas charting has no business in the server bundle, and it only mounts
// once a security is loaded.
const MarketChart = dynamic(() => import('./MarketChart'), { ssr: false });

interface MarketsPanelProps { data: any; spaceWeather?: any; }

/** The terminal's palette: amber for what things are, white for what they read, green and red for which way. */
const T = {
  amber: '#FFA028',
  text: '#E8E8E8',
  dim: '#8C8C8C',
  faint: '#5A5A5A',
  line: '#262626',
  up: '#3DDC84',
  down: '#FF5A52',
  alert: '#FF3B30',
} as const;

const SECTION_OF: Record<string, FunctionCode> = { indices: 'WEI', stocks: 'DEF', oil: 'NRG', commodities: 'CMDTY', fx: 'FX', crypto: 'CRYPTO' };
const FEED_SECTIONS = ['indices', 'stocks', 'oil', 'commodities', 'crypto', 'fx'] as const;

const moveColor = (pct: number | null | undefined) =>
  pct == null || !Number.isFinite(pct) ? T.dim : pct > 0 ? T.up : pct < 0 ? T.down : T.text;

/** The clock, ticking every `ms`. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A month of closes as one thin path, coloured by the month's direction. */
function Spark({ points }: { points?: number[] }) {
  const W = 52, H = 14;
  const path = useMemo(() => {
    if (!points || points.length < 2) return null;
    const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
    const step = W / (points.length - 1);
    return points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(H - ((p - min) / span) * H).toFixed(1)}`).join(' ');
  }, [points]);
  if (!path) return <span className="inline-block" style={{ width: W }} />;
  const month = monthChange(points);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block overflow-visible align-middle" aria-hidden="true">
      <path d={path} fill="none" stroke={moveColor(month)} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/** Where the price sits between two extremes: a hairline track and a tick. */
function RangeBar({ pos, title }: { pos: number | null; title: string }) {
  return (
    <span className="relative inline-block w-14 h-2 align-middle" title={title}>
      <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: T.faint }} />
      {pos != null && <span className="absolute top-0 h-2 w-[2px]" style={{ left: `calc(${(pos * 100).toFixed(1)}% - 1px)`, background: T.amber }} />}
    </span>
  );
}

function SortHeader({ label, k, sort, onSort, className = '' }: {
  label: string; k: SortKey; sort: { key: SortKey; asc: boolean }; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`font-normal ${className}`} aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className="hover:text-[#E8E8E8] transition-colors" style={{ color: active ? T.amber : undefined }}>
        {label}{active ? (sort.asc ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

/**
 * The monitor: one row per security. Columns appear as the table's own width
 * allows (container queries), so the same table is a compact board docked and
 * a full monitor in full screen.
 */
function SecurityTable({ groups, selected, watchlist, sort, onSort, onOpen, onStar, now }: {
  groups: { label?: string; rows: Quote[] }[];
  selected: string | null;
  watchlist: string[];
  sort: { key: SortKey; asc: boolean };
  onSort: (k: SortKey) => void;
  onOpen: (q: Quote) => void;
  onStar: (symbol: string) => void;
  now: number;
}) {
  return (
    <div className="@container">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead className="sticky top-0 z-10 bg-black">
          <tr className="text-[9px] tracking-wider text-left border-b" style={{ color: T.dim, borderColor: T.line }}>
            <th scope="col" className="w-5 font-normal"><span className="sr-only">Watch</span></th>
            <SortHeader label="SECURITY" k="name" sort={sort} onSort={onSort} className="py-1" />
            <th scope="col" className="font-normal text-right pr-2">LAST</th>
            <th scope="col" className="font-normal text-right pr-2 hidden @2xl:table-cell">NET</th>
            <SortHeader label="%CHG" k="move" sort={sort} onSort={onSort} className="text-right pr-2" />
            <SortHeader label="1M" k="month" sort={sort} onSort={onSort} className="text-right pr-1 hidden @sm:table-cell" />
            <th scope="col" className="font-normal text-center hidden @2xl:table-cell">DAY RANGE</th>
            <th scope="col" className="font-normal text-center hidden @3xl:table-cell">52W</th>
            <th scope="col" className="font-normal text-right pr-2 hidden @4xl:table-cell">VOLUME</th>
            <th scope="col" className="font-normal text-right pr-1 hidden @3xl:table-cell">TIME</th>
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={g.label ?? gi}>
            {g.label && (
              <tr>
                <td colSpan={10} className="pt-2 pb-0.5 text-[9px] tracking-[0.18em] border-b" style={{ color: T.amber, borderColor: T.line }}>{g.label}</td>
              </tr>
            )}
            {g.rows.map(q => {
              const active = selected === q.symbol;
              const starred = watchlist.includes(q.symbol);
              const net = netChange(q);
              const day = rangePosition(q.price, q.day_low, q.day_high);
              const year = rangePosition(q.price, q.low_52w, q.high_52w);
              const month = monthChange(q.spark);
              return (
                <tr
                  key={q.symbol}
                  onClick={() => onOpen(q)}
                  className="cursor-pointer odd:bg-white/[0.025] hover:bg-white/[0.07] transition-colors"
                  style={active ? { background: 'rgba(255,160,40,0.13)', boxShadow: `inset 2px 0 0 ${T.amber}` } : undefined}
                >
                  <td className="w-5 text-center">
                    <button
                      onClick={e => { e.stopPropagation(); onStar(q.symbol); }}
                      aria-label={starred ? `Remove ${q.name} from watchlist` : `Add ${q.name} to watchlist`}
                      aria-pressed={starred}
                      className="p-0.5 align-middle"
                    >
                      <Star className="w-2.5 h-2.5" fill={starred ? T.amber : 'none'} style={{ color: starred ? T.amber : T.faint }} />
                    </button>
                  </td>
                  <td className="py-[3px] pr-2 max-w-0 w-full">
                    <button
                      onClick={e => { e.stopPropagation(); onOpen(q); }}
                      className="flex items-baseline gap-1.5 min-w-0 w-full text-left"
                      title={`${q.description || q.name} — ${q.symbol}${q.exchange ? ` · ${q.exchange}` : ''}`}
                    >
                      <span className="font-bold truncate shrink-0 max-w-[60%]" style={{ color: active ? T.amber : T.text }}>{q.name}</span>
                      <span className="text-[9px] truncate" style={{ color: T.faint }}>{q.description && q.description !== q.name ? q.description : q.symbol}</span>
                    </button>
                  </td>
                  <td className="text-right pr-2 whitespace-nowrap" style={{ color: T.text }}>{formatPrice(q)}</td>
                  <td className="text-right pr-2 whitespace-nowrap hidden @2xl:table-cell" style={{ color: moveColor(net) }}>{formatNet(q, net)}</td>
                  <td className="text-right pr-2 whitespace-nowrap font-bold" style={{ color: moveColor(q.change_percent) }}>{formatMove(q.change_percent)}</td>
                  <td className="text-right pr-1 whitespace-nowrap hidden @sm:table-cell" title={`One month ${formatMove(month)}`}><Spark points={q.spark} /></td>
                  <td className="text-center hidden @2xl:table-cell">
                    <RangeBar pos={day} title={q.day_low != null && q.day_high != null ? `Day ${formatPrice(q, q.day_low)} – ${formatPrice(q, q.day_high)}` : 'No day range'} />
                  </td>
                  <td className="text-center hidden @3xl:table-cell">
                    <RangeBar pos={year} title={q.low_52w != null && q.high_52w != null ? `52 weeks ${formatPrice(q, q.low_52w)} – ${formatPrice(q, q.high_52w)}` : 'No 52-week range'} />
                  </td>
                  <td className="text-right pr-2 hidden @4xl:table-cell" style={{ color: T.dim }}>{formatVolume(q.volume)}</td>
                  <td className="text-right pr-1 hidden @3xl:table-cell" style={{ color: q.market_open ? T.text : T.dim }}>{tradeTime(q.time, now)}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export default function MarketsPanel({ data, spaceWeather }: MarketsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [maximized, setMaximized] = useState(false);
  /** Starred symbols, kept in this browser only. */
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return parseWatchlist(window.localStorage.getItem(WATCHLIST_KEY)); } catch { return []; }
  });
  const [fn, setFn] = useState<FunctionCode | 'HELP'>(() => (watchlist.length ? 'WATCH' : 'WEI'));
  /** The security loaded into the GP chart, if any. */
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'feed', asc: false });
  const [command, setCommand] = useState('');
  const [pick, setPick] = useState(-1);
  const [miss, setMiss] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const now = useNow(30_000);
  const markets = useMemo(() => data.markets || {}, [data.markets]);

  /** Every instrument, tagged with its section. */
  const allQuotes = useMemo<Quote[]>(
    () => FEED_SECTIONS.flatMap(s => Object.values<Quote>(markets[s] || {}).map(q => ({ ...q, group: q.group ?? s })))
      .filter(q => Number.isFinite(q?.price) && Number.isFinite(q?.change_percent)),
    [markets],
  );
  const bySymbol = useMemo(() => new Map(allQuotes.map(q => [q.symbol, q])), [allQuotes]);
  const feedLoaded = Boolean(markets.timestamp || markets.error);

  const breadth = useMemo(() => {
    if (!allQuotes.length) return null;
    const up = allQuotes.filter(q => q.change_percent > 0).length;
    const down = allQuotes.filter(q => q.change_percent < 0).length;
    const sorted = [...allQuotes].sort((a, b) => b.change_percent - a.change_percent);
    return { up, down, flat: allQuotes.length - up - down, total: allQuotes.length, best: sorted.slice(0, 5), worst: sorted.slice(-5).reverse() };
  }, [allQuotes]);

  // Full screen covers the map, so Escape must get out of it — unloading the
  // chart first, the nearer thing to dismiss.
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (selected) setSelected(null);
      else setMaximized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized, selected]);

  useEffect(() => {
    if (!miss) return;
    const t = setTimeout(() => setMiss(null), 2600);
    return () => clearTimeout(t);
  }, [miss]);

  const star = useCallback((symbol: string) => {
    setWatchlist(prev => {
      const next = toggleWatch(prev, symbol);
      try { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  }, []);

  const open = useCallback((q: { symbol: string }) => {
    setSelected(prev => (prev === q.symbol ? null : q.symbol));
  }, []);

  /** Load a security: chart it, and bring up the function that lists it. */
  const load = useCallback((symbol: string) => {
    const q = bySymbol.get(symbol);
    if (!q) return;
    setSelected(symbol);
    if (q.group && SECTION_OF[q.group] && fn !== 'WATCH') setFn(SECTION_OF[q.group]);
  }, [bySymbol, fn]);

  const run = useCallback((s?: Suggestion) => {
    const typed = command;
    setCommand('');
    setPick(-1);
    if (s) {
      if (s.kind === 'function') setFn(s.value as FunctionCode);
      else load(s.value);
      return;
    }
    const cmd = parseCommand(typed, allQuotes);
    if (cmd.kind === 'function') setFn(cmd.code);
    else if (cmd.kind === 'security') load(cmd.symbol);
    else if (cmd.kind === 'help') setFn('HELP');
    else if (typed.trim()) setMiss(typed.trim().toUpperCase().slice(0, 24));
  }, [command, allQuotes, load]);

  const suggestions = useMemo(() => suggest(command, allQuotes), [command, allQuotes]);

  /** Names start A→Z and numbers biggest first; a second click reverses, a third goes back to feed order. */
  const onSort = useCallback((k: SortKey) => {
    setSort(prev => {
      const first = k === 'name';
      if (prev.key !== k) return { key: k, asc: first };
      if (prev.asc === first) return { key: k, asc: !first };
      return { key: 'feed', asc: false };
    });
  }, []);

  const current = fn === 'HELP' ? null : FUNCTIONS.find(f => f.code === fn)!;

  /** The rows for the function on screen, grouped by region on WEI. */
  const groups = useMemo<{ label?: string; rows: Quote[] }[]>(() => {
    if (!current || current.section === 'donbot') return [];
    if (current.section === 'watch') {
      return [{ rows: sortQuotes(watchlist.map(s => bySymbol.get(s)).filter((q): q is Quote => !!q), sort.key, sort.asc) }];
    }
    const rows = allQuotes.filter(q => q.group === current.section);
    if (current.code === 'WEI' && sort.key === 'feed') {
      return WEI_REGIONS
        .map(r => ({ label: r.label, rows: r.symbols.map(s => bySymbol.get(s)).filter((q): q is Quote => !!q) }))
        .filter(g => g.rows.length);
    }
    return [{ rows: sortQuotes(rows, sort.key, sort.asc) }];
  }, [current, allQuotes, bySymbol, watchlist, sort]);

  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const openCount = groups.reduce((n, g) => n + g.rows.filter(q => q.market_open).length, 0);
  const updated = markets.timestamp ? tradeTime(Date.parse(markets.timestamp) / 1000, now) : '—';
  /* Full screen always has a chart up: the one loaded, else the first benchmark. */
  const chartSymbol = selected ?? (maximized ? (bySymbol.has(PULSE[0].symbol) ? PULSE[0].symbol : allQuotes[0]?.symbol ?? null) : null);
  const chartQuote = chartSymbol ? bySymbol.get(chartSymbol) : undefined;

  /* ── The pieces, shared by both layouts ───────────────────── */

  const titleBar = (
    <div className="flex items-stretch h-7 border-b shrink-0" style={{ borderColor: T.line }}>
      <button onClick={() => setExpanded(e => !e)} className="flex items-stretch min-w-0" title={expanded ? 'Collapse' : 'Expand'}>
        <span className="px-2 flex items-center text-[10px] font-bold tracking-[0.2em] text-black" style={{ background: T.amber }}>OSIRIS</span>
        <span className="px-2 flex items-center gap-2 min-w-0 text-[10px] tracking-wider">
          <span className="font-bold" style={{ color: T.amber }}>MKTS</span>
          <span className="truncate" style={{ color: T.text }}>{current ? `${current.code} · ${current.title.toUpperCase()}` : 'HELP'}</span>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-2 pr-1.5 shrink-0">
        {maximized && (
          <div className="hidden lg:flex items-center gap-3 mr-2 text-[10px] tabular-nums" title="Regular sessions, local time. Holidays and early closes are not shown.">
            {exchangeClocks(new Date(now)).map(c => (
              <span key={c.code} className="flex items-center gap-1">
                <span style={{ color: T.amber }}>{c.code}</span>
                <span style={{ color: T.text }}>{c.time}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.open ? T.up : T.faint }} title={c.open ? 'Open' : 'Closed'} />
              </span>
            ))}
          </div>
        )}
        <span className="text-[9px] tracking-wider tabular-nums" style={{ color: T.dim }} title="When the feed was last built, UTC">
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle animate-osiris-pulse" style={{ background: markets.error ? T.alert : T.up }} />
          UPD {updated}Z
        </span>
        <button
          onClick={() => { setMaximized(m => !m); setExpanded(true); }}
          className="p-1 hover:bg-white/10 transition-colors" style={{ color: T.dim }}
          title={maximized ? 'Restore' : 'Full screen'} aria-label={maximized ? 'Restore' : 'Full screen'}
        >
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setExpanded(e => !e)} className="p-1 hover:bg-white/10 transition-colors" style={{ color: T.dim }} title={expanded ? 'Collapse' : 'Expand'} aria-label={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  const commandLine = (
    <form
      onSubmit={e => { e.preventDefault(); run(pick >= 0 ? suggestions[pick] : undefined); }}
      className="relative flex items-center h-7 border-b shrink-0" style={{ borderColor: T.line }}
    >
      <span className="pl-2 pr-1.5 text-[12px] font-bold" style={{ color: T.amber }} aria-hidden="true">&gt;</span>
      <input
        value={command}
        onChange={e => { setCommand(e.target.value); setPick(-1); setMiss(null); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setPick(p => (p + 1) % suggestions.length); }
          else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setPick(p => (p <= 0 ? suggestions.length - 1 : p - 1)); }
          else if (e.key === 'Escape' && command) { e.preventDefault(); setCommand(''); setPick(-1); }
        }}
        placeholder={miss ? `NO MATCH FOR ${miss}` : 'Ticker or function — LMT, GOLD, FX, DON, HELP'}
        aria-label="Markets command: a ticker or function code"
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className={`flex-1 min-w-0 bg-transparent text-[11px] uppercase tracking-wide focus:outline-none ${miss ? 'placeholder:text-[#FF5A52]' : 'placeholder:text-[#5A5A5A] placeholder:normal-case'}`}
        style={{ color: T.text, caretColor: T.amber }}
      />
      <button type="submit" className="h-full px-2.5 text-[10px] font-bold tracking-wider text-black hover:brightness-110" style={{ background: T.amber }}>GO</button>
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 border bg-black text-[10px]" style={{ borderColor: T.line }} role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}:${s.value}`} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); run(s); }}
                onMouseEnter={() => setPick(i)}
                className="w-full flex items-center gap-2 px-2 py-1 text-left"
                style={{ background: i === pick ? 'rgba(255,160,40,0.16)' : undefined }}
              >
                <span className="w-12 shrink-0 font-bold" style={{ color: s.kind === 'function' ? T.amber : T.text }}>{s.kind === 'function' ? s.label : s.hint}</span>
                <span className="truncate" style={{ color: T.dim }}>{s.kind === 'function' ? s.hint : s.label}</span>
                <span className="ml-auto text-[9px]" style={{ color: T.faint }}>{s.kind === 'function' ? 'FUNC' : 'SEC'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );

  const functionKeys = (
    <div className="grid grid-cols-4 @sm:grid-cols-8 gap-px border-b shrink-0" style={{ background: T.line, borderColor: T.line }}>
      {FUNCTIONS.map(f => {
        const active = fn === f.code;
        return (
          <button
            key={f.code}
            onClick={() => setFn(f.code)}
            aria-pressed={active}
            title={`${f.key} ${f.code} — ${f.title}`}
            className="h-6 px-1 text-[9px] tracking-wider whitespace-nowrap transition-colors"
            style={{ background: active ? T.amber : '#0B0B0B', color: active ? '#000' : T.amber }}
          >
            <span style={{ color: active ? '#000' : T.dim }}>{f.key}</span> {f.code}
          </button>
        );
      })}
    </div>
  );

  /** The benchmarks everyone checks first, one cell each. */
  const monitor = allQuotes.length > 0 && (
    <div className={`grid gap-px border ${maximized ? 'grid-cols-4 xl:grid-cols-8' : 'grid-cols-4'}`} style={{ background: T.line, borderColor: T.line }}>
      {PULSE.map(({ symbol, label }) => {
        const q = bySymbol.get(symbol);
        const active = chartSymbol === symbol;
        return (
          <button
            key={symbol}
            onClick={() => q && open(q)}
            disabled={!q}
            title={q ? `${q.name} — chart it` : `${label} — no reading`}
            className="px-1.5 py-1 text-left bg-black hover:bg-[#141414] transition-colors disabled:opacity-40"
            style={active ? { boxShadow: `inset 0 -2px 0 ${T.amber}` } : undefined}
          >
            <div className="text-[9px] tracking-wider truncate" style={{ color: T.amber }}>{label}</div>
            <div className="text-[11px] font-bold tabular-nums truncate" style={{ color: T.text }}>{q ? formatPrice(q) : '—'}</div>
            <div className="text-[10px] tabular-nums" style={{ color: moveColor(q?.change_percent) }}>{formatMove(q?.change_percent)}</div>
          </button>
        );
      })}
    </div>
  );

  const breadthLine = breadth && (
    <div className="text-[10px] tabular-nums">
      <div className="flex items-center gap-2">
        <span style={{ color: T.amber }}>ADV</span><span style={{ color: T.up }}>{breadth.up}</span>
        <span style={{ color: T.amber }}>DEC</span><span style={{ color: T.down }}>{breadth.down}</span>
        {breadth.flat > 0 && <><span style={{ color: T.amber }}>UNCH</span><span style={{ color: T.text }}>{breadth.flat}</span></>}
        <span className="flex-1 h-1 flex overflow-hidden" aria-hidden="true">
          <span style={{ width: `${(breadth.up / breadth.total) * 100}%`, background: T.up }} />
          <span style={{ width: `${(breadth.flat / breadth.total) * 100}%`, background: T.faint }} />
          <span style={{ width: `${(breadth.down / breadth.total) * 100}%`, background: T.down }} />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5" style={{ color: T.dim }}>
        <button className="truncate hover:text-[#E8E8E8]" onClick={() => open(breadth.best[0])}>BEST <span style={{ color: T.text }}>{breadth.best[0].name}</span> <span style={{ color: T.up }}>{formatMove(breadth.best[0].change_percent)}</span></button>
        <button className="truncate hover:text-[#E8E8E8]" onClick={() => open(breadth.worst[0])}>WORST <span style={{ color: T.text }}>{breadth.worst[0].name}</span> <span style={{ color: T.down }}>{formatMove(breadth.worst[0].change_percent)}</span></button>
      </div>
    </div>
  );

  const alerts = Array.isArray(markets.scm_alerts) && markets.scm_alerts.length > 0 && (
    <div className="space-y-px">
      {markets.scm_alerts.map((alert: string, i: number) => (
        <div key={i} className="flex items-start gap-2 text-[10px] leading-snug">
          <span className="px-1 font-bold text-black shrink-0" style={{ background: T.alert }}>ALRT</span>
          <span style={{ color: T.amber }}>{String(alert).replace(/^\W+\s*/u, '')}</span>
        </div>
      ))}
    </div>
  );

  const chart = chartSymbol && chartQuote && (
    <MarketChart key={chartSymbol} symbol={chartSymbol} name={longName(chartQuote)} large={maximized} onClose={() => setSelected(null)} />
  );

  const help = (
    <div className="text-[10px] leading-relaxed space-y-2" style={{ color: T.dim }}>
      <div style={{ color: T.amber }}>TYPE A FUNCTION OR A SECURITY, THEN GO</div>
      <table className="w-full">
        <tbody>
          {FUNCTIONS.map(f => (
            <tr key={f.code}>
              <td className="pr-2 w-16 font-bold" style={{ color: T.amber }}>{f.key} {f.code}</td>
              <td style={{ color: T.text }}>{f.title}</td>
              <td className="text-right" style={{ color: T.faint }}>{f.aliases.slice(0, 2).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        Securities by ticker or name: <span style={{ color: T.text }}>LMT</span>, <span style={{ color: T.text }}>lmt us equity</span>, <span style={{ color: T.text }}>gold</span>, <span style={{ color: T.text }}>eurusd</span>, <span style={{ color: T.text }}>nikkei</span>.
        ↑↓ pick a suggestion · Esc clears · ★ adds a row to WATCH. Click a column head to sort.
      </div>
    </div>
  );

  const tableHeader = current && current.section !== 'donbot' && (
    <div className="flex items-center justify-between text-[9px] tracking-wider pb-1" style={{ color: T.dim }}>
      <span style={{ color: T.amber }}>{current.code} · {rowCount} SECURITIES</span>
      {rowCount > 0 && current.section !== 'crypto' && <span>{openCount ? <><span style={{ color: T.up }}>●</span> {openCount} TRADING</> : 'SESSIONS CLOSED'}</span>}
    </div>
  );

  const content = fn === 'HELP' ? help
    : current?.section === 'donbot' ? <DonBotScan />
    : (
      <div>
        {tableHeader}
        {rowCount > 0 ? (
          <SecurityTable groups={groups} selected={chartSymbol} watchlist={watchlist} sort={sort} onSort={onSort} onOpen={open} onStar={star} now={now} />
        ) : (
          <div className="py-4 text-center text-[10px] tracking-wider" style={{ color: T.dim }}>
            {current?.section === 'watch' ? 'NOTHING ON WATCH — ★ A ROW TO ADD IT'
              : feedLoaded ? 'FEED UNAVAILABLE — RETRYING' : 'LOADING…'}
          </div>
        )}
      </div>
    );

  const heatmap = allQuotes.length > 0 && (
    <div>
      <div className="text-[9px] tracking-[0.18em] pb-1" style={{ color: T.amber }}>IMAP · TODAY&apos;S MOVE</div>
      <div className="space-y-1">
        {FEED_SECTIONS.map(s => {
          const quotes = allQuotes.filter(q => q.group === s);
          if (!quotes.length) return null;
          return (
            <div key={s} className="flex items-stretch gap-px">
              <button onClick={() => setFn(SECTION_OF[s])} className="w-14 shrink-0 text-left text-[9px] tracking-wider pt-0.5 hover:text-[#E8E8E8]" style={{ color: T.dim }}>{SECTION_OF[s]}</button>
              <div className="flex flex-wrap gap-px flex-1">
                {quotes.map(q => (
                  <button
                    key={q.symbol}
                    onClick={() => open(q)}
                    title={`${q.name} ${formatMove(q.change_percent)}`}
                    className="w-[84px] px-1 py-0.5 text-left hover:brightness-125"
                    style={{ background: heat(q.change_percent).background, boxShadow: chartSymbol === q.symbol ? `inset 0 0 0 1px ${T.amber}` : undefined }}
                  >
                    <div className="text-[9px] truncate" style={{ color: T.text }}>{q.name}</div>
                    <div className="text-[10px] font-bold tabular-nums" style={{ color: moveColor(q.change_percent) }}>{formatMove(q.change_percent)}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const movers = breadth && (
    <div>
      <div className="text-[9px] tracking-[0.18em] pb-1" style={{ color: T.amber }}>MOVERS · ALL MARKETS</div>
      <div className="grid grid-cols-2 gap-3 text-[10px] tabular-nums">
        {[breadth.best, breadth.worst].map((list, col) => (
          <div key={col}>
            {list.map(q => (
              <button key={q.symbol} onClick={() => open(q)} className="w-full flex justify-between gap-2 py-[2px] hover:bg-white/[0.06]">
                <span className="truncate" style={{ color: T.text }}>{q.name}</span>
                <span style={{ color: moveColor(q.change_percent) }}>{formatMove(q.change_percent)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2 text-[9px] tracking-wider pt-1 border-t" style={{ color: T.faint, borderColor: T.line }}>
      {spaceWeather ? (
        <span className="truncate">
          <span style={{ color: T.amber }}>SPACE WX</span>{' '}
          <span style={{ color: spaceWeather.storm_color || T.text }}>
            {spaceWeather.kp_index == null ? 'NO READING' : `Kp ${spaceWeather.kp_index} ${String(spaceWeather.storm_level || '').toUpperCase()}`}
          </span>
          {spaceWeather.solar_flares?.length > 0 && <> · FLARE {spaceWeather.solar_flares[0].class}</>}
        </span>
      ) : <span />}
      <span className="shrink-0">SRC YAHOO · NOAA</span>
    </div>
  );

  const ai = <AiOverview mode="markets" payload={{ markets, spaceWeather }} accent={T.amber} />;

  const body = maximized ? (
    /* Full screen: the monitor and the map of the day on the left, the chart
       and what moved beside it. Each column scrolls on its own. */
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-2">
      {monitor}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,34%)] gap-3 overflow-y-auto lg:overflow-hidden styled-scrollbar">
        <div className="min-h-0 lg:overflow-y-auto styled-scrollbar space-y-3 pr-1">
          {content}
          {heatmap}
        </div>
        <div className="min-h-0 lg:overflow-y-auto styled-scrollbar space-y-3 lg:border-l lg:pl-3" style={{ borderColor: T.line }}>
          {chart}
          {breadthLine}
          {alerts}
          {movers}
          {footer}
          {ai}
        </div>
      </div>
    </div>
  ) : (
    /* Docked: one scroll region, capped so the panel ends above the status bar. */
    <div className="space-y-2 p-2 overflow-y-auto styled-scrollbar max-h-[calc(100vh-14rem)]">
      {monitor}
      {breadthLine}
      {alerts}
      {chart}
      {content}
      {footer}
      {ai}
    </div>
  );

  const terminal = (
    // Opacity only on entry: a transform left behind here offsets the `fixed`
    // full-screen box away from its inset.
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      className={`@container font-mono pointer-events-auto flex flex-col bg-black border shadow-[0_12px_40px_rgba(0,0,0,0.6)] ${
        // `relative` and `fixed` are both position utilities; list only one.
        maximized ? 'fixed inset-3 z-[9999]' : 'relative'
      }`}
      style={{ borderColor: T.line, borderTop: `2px solid ${T.amber}` }}
      role="region"
      aria-label="Markets terminal"
    >
      {titleBar}
      {expanded && (
        <>
          {commandLine}
          {functionKeys}
          {body}
        </>
      )}
    </motion.div>
  );

  if (maximized && mounted && typeof document !== 'undefined') return createPortal(terminal, document.body);
  return terminal;
}
