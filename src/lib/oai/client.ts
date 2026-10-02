'use client';
/**
 * OAI in the browser: the visitor's engine settings and key, the run
 * they are watching (followed over Server-Sent Events and folded with the
 * same applyEvent the server uses), their history, and the calls that start,
 * steer and question a run.
 *
 * The key is kept in this browser only: in localStorage if the visitor asks
 * to be remembered, otherwise in sessionStorage, which the tab forgets when it
 * closes. It travels to OSIRIS in a header on each call that needs it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderId } from './providers';
import { applyEvent, currentProbability, initialState, type RunState } from './state';
import type { Depth, RunStatus, Stamped } from './types';

export interface Engine {
  provider: ProviderId;
  model: string;
  remember: boolean;
}

export interface HistoryEntry {
  id: string;
  question: string;
  at: number;
  probability: number | null;
  status: RunStatus;
  provider: string;
  model: string;
}

const ENGINE_KEY = 'osiris.oai.engine';
const HISTORY_KEY = 'osiris.oai.history';
const TOKENS_KEY = 'osiris.oai.tokens';
const keySlot = (p: string) => `osiris.oai.key.${p}`;
const HISTORY_CAP = 25;

function store(kind: 'local' | 'session'): Storage | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}
function read(kind: 'local' | 'session', k: string): string | null {
  try { return store(kind)?.getItem(k) ?? null; } catch { return null; }
}
function write(kind: 'local' | 'session', k: string, v: string | null) {
  try {
    const s = store(kind);
    if (!s) return;
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch { /* storage full or blocked: settings just do not persist */ }
}

export function loadEngine(): Engine | null {
  try {
    const e = JSON.parse(read('local', ENGINE_KEY) || 'null');
    if (e && typeof e.provider === 'string' && typeof e.model === 'string') return { provider: e.provider, model: e.model, remember: Boolean(e.remember) };
  } catch { /* corrupt: start over */ }
  return null;
}

export function saveEngine(e: Engine) {
  write('local', ENGINE_KEY, JSON.stringify(e));
}

export function loadKey(provider: string): string {
  return read('local', keySlot(provider)) || read('session', keySlot(provider)) || '';
}

/** Keeps the key where the visitor chose, and removes it from the other place. */
export function saveKey(provider: string, key: string, remember: boolean) {
  write(remember ? 'local' : 'session', keySlot(provider), key || null);
  write(remember ? 'session' : 'local', keySlot(provider), null);
}

export function forgetKey(provider: string) {
  write('local', keySlot(provider), null);
  write('session', keySlot(provider), null);
}

function loadHistory(): HistoryEntry[] {
  try {
    const h = JSON.parse(read('local', HISTORY_KEY) || '[]');
    return Array.isArray(h) ? h.filter(x => x && typeof x.id === 'string' && typeof x.question === 'string').slice(0, HISTORY_CAP) : [];
  } catch { return []; }
}

function tokens(): Record<string, string> {
  try { return JSON.parse(read('session', TOKENS_KEY) || '{}') || {}; } catch { return {}; }
}

/** Puts the run in the address (or takes it out), leaving the other parameters exactly as they were written. */
function setUrlRun(id: string | null) {
  try {
    const { pathname, search, hash } = window.location;
    const rest = search.replace(/^\?/, '').split('&').filter(p => p && !p.startsWith('oai='));
    if (id) rest.push(`oai=${id}`);
    window.history.replaceState(window.history.state, '', `${pathname}${rest.length ? `?${rest.join('&')}` : ''}${hash}`);
  } catch { /* not in a browser */ }
}

const headersFor = (engine: Engine, key: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-oai-provider': engine.provider,
  'x-oai-model': engine.model,
  ...(key ? { 'x-oai-key': key } : {}),
});

async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === 'string' ? body.error : '') || `OAI answered ${res.status}.`;
}

export interface StartInput {
  question: string;
  seed: string;
  depth: Depth;
  useFeeds: boolean;
}

export function useOai() {
  const [state, setState] = useState<RunState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Read from this browser on the first client render; the server has no storage and renders none.
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [token, setToken] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const queue = useRef<Stamped[]>([]);
  const frame = useRef(0);
  /** The run as folded so far, and whose it is: the stream handler reads these outside React's render. */
  const latest = useRef<RunState | null>(null);
  const following = useRef<string | null>(null);

  /** Keeps the history entry in step with how a run ended. */
  const record = useCallback((id: string, s: RunState) => {
    const probability = currentProbability(s);
    setHistory(h => {
      const i = h.findIndex(x => x.id === id);
      if (i < 0 || (h[i].status === s.status && h[i].probability === probability)) return h;
      const next = h.slice();
      next[i] = { ...h[i], status: s.status, probability };
      write('local', HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const flush = useCallback(() => {
    frame.current = 0;
    const events = queue.current.splice(0);
    if (!events.length) return;
    const next = events.reduce(applyEvent, latest.current ?? initialState());
    latest.current = next;
    setState(next);
    if (following.current && next.status !== 'running') record(following.current, next);
  }, [record]);

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
    queue.current = [];
    if (frame.current) clearTimeout(frame.current);
    frame.current = 0;
  }, []);

  useEffect(() => close, [close]);

  /** Follows a run: replays it from the start, then live. False when it is gone. */
  const watch = useCallback(async (id: string): Promise<boolean> => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    close();
    latest.current = null;
    following.current = id;
    setError('');
    setState(null);
    setRunId(id);
    setToken(tokens()[id] ?? null);
    const res = await fetch(`/api/oai/runs/${id}`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 404 ? 'That forecast has expired. Runs are kept for a few hours.' : 'Could not reach OAI.');
      setRunId(null);
      setUrlRun(null);
      return false;
    }
    setUrlRun(id);
    const es = new EventSource(`/api/oai/runs/${id}/events`);
    source.current = es;
    es.onmessage = m => {
      let e: Stamped;
      try { e = JSON.parse(m.data); } catch { return; }
      queue.current.push(e);
      // The run is over: stop here, or the browser would reconnect when the server closes the stream.
      if (e.t === 'end') { es.close(); if (source.current === es) source.current = null; }
      // One render per short beat, however fast events arrive (a replay sends hundreds at once).
      // A timer, not an animation frame: frames stop while the tab is hidden, and a run must keep
      // up when its watcher switches tabs.
      if (!frame.current) frame.current = window.setTimeout(flush, 60);
    };
    // A dropped connection reconnects by itself and resumes from the last event it saw. One the
    // server refused outright (too many streams, a run gone) does not: say so rather than sit silent.
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || source.current !== es) return;
      source.current = null;
      setError('Lost the live stream of this run. Reopen it from your forecasts to catch up.');
    };
    return true;
  }, [close, flush]);

  const start = useCallback(async (input: StartInput, engine: Engine, key: string): Promise<string | null> => {
    setError('');
    let res: Response;
    try {
      res = await fetch('/api/oai/runs', {
        method: 'POST',
        headers: headersFor(engine, key),
        body: JSON.stringify({ question: input.question, seed: input.seed, depth: input.depth, use_feeds: input.useFeeds }),
      });
    } catch {
      setError('Could not reach OAI.');
      return null;
    }
    if (!res.ok) { setError(await errorOf(res)); return null; }
    const body = await res.json();
    write('session', TOKENS_KEY, JSON.stringify({ ...tokens(), [body.id]: body.run_token }));
    const entry: HistoryEntry = { id: body.id, question: input.question, at: Date.now(), probability: null, status: 'running', provider: engine.provider, model: engine.model };
    setHistory(h => {
      const next = [entry, ...h.filter(x => x.id !== body.id)].slice(0, HISTORY_CAP);
      write('local', HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    await watch(body.id);
    return body.id;
  }, [watch]);

  const cancel = useCallback(async () => {
    if (!runId || !token) return;
    await fetch(`/api/oai/runs/${runId}`, { method: 'DELETE', headers: { 'x-oai-run-token': token } }).catch(() => null);
  }, [runId, token]);

  const inject = useCallback(async (text: string): Promise<string | null> => {
    if (!runId || !token) return 'Only the browser that started this run can steer it.';
    const res = await fetch(`/api/oai/runs/${runId}/inject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oai-run-token': token },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    if (!res) return 'Could not reach OAI.';
    return res.ok ? null : errorOf(res);
  }, [runId, token]);

  const ask = useCallback(async (target: string, message: string, engine: Engine, key: string): Promise<{ reply?: string; error?: string }> => {
    if (!runId) return { error: 'No run.' };
    const res = await fetch(`/api/oai/runs/${runId}/ask`, {
      method: 'POST',
      headers: headersFor(engine, key),
      body: JSON.stringify({ target, message }),
    }).catch(() => null);
    if (!res) return { error: 'Could not reach OAI.' };
    if (!res.ok) return { error: await errorOf(res) };
    return { reply: (await res.json()).reply };
  }, [runId]);

  const clear = useCallback(() => {
    close();
    latest.current = null;
    following.current = null;
    setState(null);
    setRunId(null);
    setToken(null);
    setError('');
    setUrlRun(null);
  }, [close]);

  const forget = useCallback((id: string) => {
    setHistory(h => {
      const next = h.filter(x => x.id !== id);
      write('local', HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { state, runId, error, setError, history, canSteer: Boolean(token), start, watch, cancel, inject, ask, clear, forget };
}

export type OaiClient = ReturnType<typeof useOai>;

/** Checks a key by listing the models it can use. */
export async function checkKey(provider: ProviderId, key: string): Promise<{ models: { id: string; name: string }[]; preferred: string } | { error: string }> {
  const res = await fetch('/api/oai/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-oai-provider': provider, ...(key ? { 'x-oai-key': key } : {}) },
    body: JSON.stringify({ provider }),
  }).catch(() => null);
  if (!res) return { error: 'Could not reach OAI.' };
  if (!res.ok) return { error: await errorOf(res) };
  const body = await res.json();
  return { models: body.models ?? [], preferred: body.default ?? '' };
}

/** The forecast as Markdown, for export. */
export function toMarkdown(s: RunState, url: string): string {
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const r = s.report;
  const lines = [`# ${r?.headline || s.question}`, '', `**Question:** ${s.question}`];
  if (s.frame) lines.push(`**Proposition:** ${s.frame.proposition}`, s.frame.horizon ? `**Horizon:** ${s.frame.horizon}` : '', `**Base rate:** ${pct(s.frame.baseRate)}: ${s.frame.baseRateReason}`);
  if (r) {
    lines.push('', `## Forecast: ${pct(r.probability)} (${r.confidence} confidence)`, `Panel consensus ${pct(r.swarm)}.${r.deviation ? ` ${r.deviation}` : ''}`, '', r.summary);
    if (r.drivers.length) lines.push('', '## Drivers', ...r.drivers.map(d => `- ${d.push === 'yes' ? '▲' : '▼'} ${d.text}`));
    if (r.scenarios.length) lines.push('', '## Scenarios', ...r.scenarios.map(x => `- **${x.name}** (${pct(x.probability)}): ${x.description}`));
    if (r.signposts.length) lines.push('', '## Signposts', ...r.signposts.map(x => `- ${x.text}${x.place ? ` (${x.place})` : ''}: points ${x.means.toUpperCase()}`));
    if (r.dissent) lines.push('', '## Dissent', r.dissent);
    if (r.caveats.length) lines.push('', '## Caveats', ...r.caveats.map(c => `- ${c}`));
  }
  if (s.rounds.length) lines.push('', '## The panel by round', ...s.rounds.map(x => `- Round ${x.round}: ${pct(x.consensus)} (middle half ${pct(x.p25)}–${pct(x.p75)}, ${x.n} panelists)`));
  lines.push('', `Run on ${s.provider} / ${s.model}, ${s.usage.calls} model calls. Watch: ${url}`, '', '_OSIRIS OAI: swarm forecasting after MiroFish, rebuilt natively. A simulation, not a guarantee._');
  return lines.filter(l => l !== '').join('\n').replace(/\n(#+ )/g, '\n\n$1');
}
