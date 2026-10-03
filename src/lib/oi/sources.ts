/**
 * OSIRIS OI: what the panel quotes, and where it came from.
 *
 * Every panelist backs each post with quotes from numbered sources: an item
 * of the live feed (`c3`), a passage the world model lifted from the asker's
 * own data (`d2`), or, when the whole panel reads it, that data itself
 * (`data`). A quote is checked against its source here and marked exact when
 * its words are really there, so a reader following the thread from the
 * report to a panelist to a source can trust the last step. Pure and
 * client-safe.
 */
import type { Citation, ContextItem } from './types';

const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
/** A model's string, on one line, cut to `max`. */
const text = (v: unknown, max: number): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\s\u0000-\u001f]+/g, ' ').trim().slice(0, max) : '';

/** The id of the asker's data as a whole, citable when the whole panel reads it. */
export const DATA_ID = 'data';

/** Text reduced to its words: case, accents, punctuation and spacing ignored. */
export function foldQuote(t: string): string {
  return t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Whether a quote is really in a source: its words, in order, allowing an
 * ellipsis between pieces. Too short to mean anything is not a quote.
 */
export function quoteIn(quote: string, source: string): boolean {
  const pieces = quote.split(/\.{3}|…/).map(foldQuote).filter(Boolean);
  if (!pieces.length || pieces.join(' ').length < 8) return false;
  const hay = ` ${foldQuote(source)} `;
  let from = 0;
  for (const p of pieces) {
    const at = hay.indexOf(` ${p} `, from);
    if (at < 0) return false;
    from = at + p.length + 1;
  }
  return true;
}

/** The parts of the asker's data, by the "### name" headings the panel puts above each file. */
function sections(seed: string): { name: string; body: string }[] {
  const parts = seed.split(/^### (.+)$/m);
  if (parts.length < 3) return [{ name: '', body: seed }];
  const out: { name: string; body: string }[] = parts[0].trim() ? [{ name: '', body: parts[0] }] : [];
  for (let i = 1; i < parts.length; i += 2) out.push({ name: parts[i].trim(), body: parts[i + 1] ?? '' });
  return out;
}

/**
 * The passages the world model quoted from the asker's data, as sources the
 * panel can cite: `d1`, `d2`… in the model's own order (so its evidence can
 * point at them), keeping only those really in the data, each under the
 * file it came from.
 */
export function dataExcerpts(raw: unknown, seed: string, max = 8): ContextItem[] {
  if (!seed.trim()) return [];
  const parts = sections(seed);
  const out: ContextItem[] = [];
  list(raw, max).forEach((q, i) => {
    const o = q && typeof q === 'object' ? (q as Record<string, unknown>) : { text: q };
    const passage = text(o.text ?? o.quote, 300);
    if (!passage) return;
    const part = parts.find(p => quoteIn(passage, p.body));
    if (!part) return;
    out.push({
      id: `d${i + 1}`,
      kind: 'data',
      title: passage,
      source: part.name && part.name !== 'Notes' ? part.name : part.name === 'Notes' ? 'Your notes' : 'Your data',
      published: '',
      place: '',
      lat: null,
      lng: null,
    });
  });
  return out;
}

/** The asker's data as one source, for the panel that reads it whole. */
export function wholeData(seed: string): ContextItem {
  const names = sections(seed).map(p => p.name).filter(n => n && n !== 'Notes');
  return { id: DATA_ID, kind: 'data', title: 'Your data', source: names.length ? names.join(', ') : 'Pasted by you', published: '', place: '', lat: null, lng: null };
}

/**
 * What each citable source says, to check quotes against: a feed item's
 * headline (and its outlet, which a panelist may name), a data passage, and
 * the head of the data itself when the whole panel reads it.
 */
export function sourceTexts(items: ContextItem[], panelData = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of items) out.set(c.id, c.id === DATA_ID ? panelData : c.kind === 'data' ? c.title : `${c.title} ${c.source}`);
  return out;
}

/**
 * A reply's citations: up to `max`, of known sources only, one per source,
 * each quote checked against what the source says.
 */
export function parseCites(raw: unknown, sources: Map<string, string>, max = 3): Citation[] {
  const out: Citation[] = [];
  for (const c of list(raw, 6)) {
    const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
    const source = text(o.source ?? o.id, 12).toLowerCase().replace(/^\[|\]$/g, '');
    const quote = text(o.quote ?? o.text, 240).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
    if (!sources.has(source) || !quote || out.some(x => x.source === source)) continue;
    out.push({ source, quote, exact: quoteIn(quote, sources.get(source)!) });
    if (out.length >= max) break;
  }
  return out;
}

/** Source ids from a model's list, known ones only, without repeats. */
export function sourceIds(raw: unknown, sources: Set<string>, max = 4): string[] {
  const out: string[] = [];
  for (const v of list(raw, 8)) {
    const id = text(v, 12).toLowerCase().replace(/^\[|\]$/g, '');
    if (sources.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
