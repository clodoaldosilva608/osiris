/**
 * The live world a run starts from: OSIRIS's own news feed, the day's large
 * earthquakes and a line of market prices, cut down to what bears on the
 * question. Read in-process from the same cached sources the map uses, so a
 * run adds no upstream traffic of its own.
 */
import type { ContextItem } from './types';
import { text } from './parse';

export interface RawNews {
  title?: string;
  summary?: string;
  description?: string;
  published?: string;
  source_name?: string;
  source?: string;
  risk_score?: number;
  place?: { label?: string; name?: string; lat?: number; lng?: number } | null;
  /** [lat, lng] */
  coords?: [number, number] | null;
  coords_anchor?: string | null;
}

export interface RawQuake {
  magnitude?: number;
  place?: string;
  time?: number;
  lat?: number;
  lng?: number;
}

export interface RawQuote {
  name: string;
  price: number;
  change_percent: number;
}

export interface Sources {
  news(): Promise<RawNews[]>;
  quakes(): Promise<RawQuake[]>;
  quotes(): Promise<RawQuote[]>;
}

const STOP = new Set(`
  the and for are but not you all any can had her was one our out has have his how its may new now old see two way who
  did get let say she too use will would could should what when where which while with without within into onto from
  this that these those than then them they their there here about above after again against before below between
  both during each few more most other over same some such only own under until very just also been being does doing
  done make made next last year years month months week weeks day days time end happen happens happening likely chance
  probability predict prediction forecast question whether does dont isnt arent wont cant per via upon among across
`.split(/\s+/).filter(Boolean));

/** The words of a question worth matching headlines on. */
export function terms(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const raw of t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
      out.add(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
      if (out.size >= 40) break;
    }
  }
  return [...out];
}

function hit(hay: string, term: string): boolean {
  const i = hay.indexOf(term);
  if (i < 0) return false;
  // A word start, so "ran" does not match "Iran" and "oil" does not match "turmoil".
  return i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1]);
}

export function scoreNews(item: RawNews, q: string[]): number {
  const title = (item.title || '').toLowerCase();
  const body = `${item.summary || ''} ${item.description || ''}`.slice(0, 600).toLowerCase();
  const place = `${item.place?.label || ''} ${item.coords_anchor || ''}`.toLowerCase();
  let score = 0;
  for (const t of q) {
    if (hit(title, t)) score += 3;
    else if (hit(body, t)) score += 1;
    if (hit(place, t)) score += 1;
  }
  return score;
}

function newsItem(n: RawNews, id: string): ContextItem {
  const lat = n.place?.lat ?? n.coords?.[0] ?? null;
  const lng = n.place?.lng ?? n.coords?.[1] ?? null;
  const ok = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    id,
    kind: 'news',
    title: text(n.title, 220, 'Untitled'),
    source: text(n.source_name || n.source, 60),
    published: typeof n.published === 'string' ? n.published : '',
    place: text(n.place?.label || n.place?.name || n.coords_anchor, 80),
    lat: ok ? lat : null,
    lng: ok ? lng : null,
  };
}

const QUAKE_WORDS = /quake|seismic|tsunami|volcan|eruption|fault|aftershock|magnitude/i;

export function selectContext(
  question: string, seed: string, limit: number,
  data: { news: RawNews[]; quakes: RawQuake[]; quotes: RawQuote[] },
  now = Date.now(),
): ContextItem[] {
  const q = terms(question, seed.slice(0, 2000));
  const recent = data.news.filter(n => {
    const t = Date.parse(n.published || '');
    return !Number.isFinite(t) || now - t < 72 * 3_600_000;
  });

  const scored = recent
    .map(n => ({ n, s: scoreNews(n, q), t: Date.parse(n.published || '') || 0 }))
    .sort((a, b) => b.s - a.s || b.t - a.t);
  const relevant = scored.filter(x => x.s >= 3);
  const picked = relevant.slice(0, limit - 1).map(x => x.n);

  // Too little on topic: add the biggest stories of the moment, so the panel still sees the world.
  if (picked.length < 6) {
    const general = recent
      .filter(n => !picked.includes(n))
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0) || Date.parse(b.published || '') - Date.parse(a.published || ''))
      .slice(0, Math.min(limit - 1, 8) - picked.length);
    picked.push(...general);
  }

  const items: ContextItem[] = picked.map((n, i) => newsItem(n, `c${i + 1}`));

  const quakeAsked = QUAKE_WORDS.test(question) || QUAKE_WORDS.test(seed.slice(0, 2000));
  const quakes = data.quakes
    .filter(e => (e.magnitude || 0) >= 5 && Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .filter(e => quakeAsked || q.some(t => hit((e.place || '').toLowerCase(), t)))
    .sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))
    .slice(0, 3);
  for (const e of quakes) {
    items.push({
      id: `c${items.length + 1}`,
      kind: 'quake',
      title: text(`M${(e.magnitude || 0).toFixed(1)} earthquake, ${e.place || 'unknown location'}`, 160),
      source: 'USGS',
      published: e.time ? new Date(e.time).toISOString() : '',
      place: text(e.place, 80),
      lat: e.lat!,
      lng: e.lng!,
    });
  }

  const board = marketLine(data.quotes);
  if (board) {
    items.push({ id: `c${items.length + 1}`, kind: 'market', title: board, source: 'OSIRIS Markets', published: new Date(now).toISOString(), place: '', lat: null, lng: null });
  }
  return items;
}

const BOARD = ['S&P 500', 'Nasdaq 100', 'VIX', 'US 10Y', 'Dollar Index', 'WTI Crude', 'Brent Crude', 'Natural Gas', 'Gold', 'Wheat', 'Bitcoin', 'EUR/USD', 'USD/CNY'];

/** One line of the main prices, the way a desk would read them out. */
export function marketLine(quotes: RawQuote[]): string {
  const by = new Map(quotes.map(q => [q.name, q]));
  const parts = BOARD.flatMap(name => {
    const q = by.get(name);
    if (!q || !Number.isFinite(q.price)) return [];
    const d = q.price < 10 ? 4 : 2;
    const move = Number.isFinite(q.change_percent) ? ` ${q.change_percent >= 0 ? '+' : ''}${q.change_percent.toFixed(2)}%` : '';
    return [`${name} ${q.price.toLocaleString('en-US', { maximumFractionDigits: d })}${move}`];
  });
  return parts.length ? `Markets now: ${parts.join(' · ')}` : '';
}

const within = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

/** The default sources: the app's own routes, loaded on first use so tests never pull them in. */
export const liveSources: Sources = {
  async news() {
    const { GET } = await import('@/app/api/news/route');
    const body = await (await GET()).json();
    return Array.isArray(body?.news) ? body.news : [];
  },
  async quakes() {
    const { GET } = await import('@/app/api/earthquakes/route');
    const body = await (await GET()).json();
    return Array.isArray(body?.earthquakes) ? body.earthquakes : [];
  },
  async quotes() {
    const { getQuotes } = await import('@/app/api/markets/route');
    return getQuotes();
  },
};

/** Live context for a question. Each source has a few seconds; one that is slow or down costs only its own items. */
export async function gatherContext(question: string, seed: string, limit: number, sources: Sources = liveSources): Promise<ContextItem[]> {
  const [news, quakes, quotes] = await Promise.all([
    within(sources.news(), 15_000, [] as RawNews[]),
    within(sources.quakes(), 8_000, [] as RawQuake[]),
    within(sources.quotes(), 8_000, [] as RawQuote[]),
  ]);
  return selectContext(question, seed, limit, { news, quakes, quotes });
}

/**
 * A world brief for an outside caller (the MCP tool): the stories on a topic,
 * or the biggest of the moment when there is none, with the day's large
 * earthquakes and the market line.
 */
export async function briefing(topic: string, limit: number, sources: Sources = liveSources): Promise<ContextItem[]> {
  const [news, quakes, quotes] = await Promise.all([
    within(sources.news(), 15_000, [] as RawNews[]),
    within(sources.quakes(), 8_000, [] as RawQuake[]),
    within(sources.quotes(), 8_000, [] as RawQuote[]),
  ]);
  if (topic.trim()) return selectContext(topic, '', limit, { news, quakes, quotes });
  const now = Date.now();
  const top = news
    .filter(n => { const t = Date.parse(n.published || ''); return !Number.isFinite(t) || now - t < 24 * 3_600_000; })
    .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0) || Date.parse(b.published || '') - Date.parse(a.published || ''))
    .slice(0, Math.max(1, limit - 1));
  const items = top.map((n, i) => newsItem(n, `c${i + 1}`));
  for (const e of quakes.filter(q => (q.magnitude || 0) >= 6).slice(0, 3)) {
    items.push({
      id: `c${items.length + 1}`, kind: 'quake', title: text(`M${(e.magnitude || 0).toFixed(1)} earthquake, ${e.place || 'unknown location'}`, 160),
      source: 'USGS', published: e.time ? new Date(e.time).toISOString() : '', place: text(e.place, 80), lat: e.lat ?? null, lng: e.lng ?? null,
    });
  }
  const board = marketLine(quotes);
  if (board) items.push({ id: `c${items.length + 1}`, kind: 'market', title: board, source: 'OSIRIS Markets', published: new Date(now).toISOString(), place: '', lat: null, lng: null });
  return items;
}
