'use client';
/**
 * OSIRIS OI Assist: the conversation.
 *
 * Talk to OI, typed or spoken, and it works the map for you: it flies there,
 * switches the layers on, finds what is live, marks it, and puts it on screen
 * as cards you can click through; it reads the markets, opens panels, and
 * starts forecasts. Each turn shows what OI did, step by step, as it does it.
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp, Compass, Eraser, ExternalLink, Globe2, Layers, List, Loader2, LocateFixed, MapPin, Mic, Navigation, Orbit, PanelRight,
  RotateCcw, ScanSearch, Search, Square, TrendingUp, Volume2, VolumeX, X, type LucideProps,
} from 'lucide-react';
import type { OiClient } from '@/lib/oi/client';
import type { ActionView, AssistClient, Entry } from '@/lib/oi/assist/client';
import type { Mode, ToolName } from '@/lib/oi/assist/protocol';
import type { Card } from '@/lib/oi/assist/tools';
import { currentAnswer } from '@/lib/oi/state';
import { LABEL, T, gold, shortName } from '../theme';
import { OiMark, Segmented } from '../atoms';
import { canSpeak, useDictation } from './voice';

const TOOL_ICON: Record<ToolName, typeof Navigation> = {
  go_to: Navigation, layers: Layers, find: Search, scan: ScanSearch, highlight: MapPin, show: List, markets: TrendingUp,
  open: PanelRight, map_view: Globe2, forecast: Orbit, clear: Eraser,
};

function ToolIcon({ tool, ...rest }: LucideProps & { tool: ToolName }) {
  return createElement(TOOL_ICON[tool], rest);
}

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'OI decides what to do' },
  { value: 'navigate', label: 'Navigate', title: 'Move the map and switch layers' },
  { value: 'research', label: 'Research', title: 'Gather live data and put it on screen' },
  { value: 'forecast', label: 'Forecast', title: 'Run the forecasting swarm on your question' },
];

const SUGGESTIONS: { group: string; mode: Mode; text: string }[] = [
  { group: 'Navigate', mode: 'navigate', text: 'Take me to the Strait of Hormuz and show the shipping' },
  { group: 'Navigate', mode: 'navigate', text: 'Fly to Kyiv and turn on the war alerts' },
  { group: 'Research', mode: 'research', text: 'What am I looking at?' },
  { group: 'Research', mode: 'research', text: 'Earthquakes above M5 in the last day' },
  { group: 'Research', mode: 'research', text: 'Military aircraft near the Baltic Sea' },
  { group: 'Research', mode: 'research', text: 'What is happening in Sudan right now?' },
  { group: 'Research', mode: 'research', text: 'How are oil, gold and bitcoin trading?' },
  { group: 'Forecast', mode: 'forecast', text: 'Will OPEC+ announce a production cut before December 2026?' },
];

/** What an action is doing, in words, before its result says what it did. */
function describe(a: ActionView): string {
  const g = (k: string) => (typeof a.args[k] === 'string' || typeof a.args[k] === 'number' ? String(a.args[k]) : '');
  switch (a.tool) {
    case 'go_to': return `Fly to ${g('place') || [g('lat'), g('lng')].filter(Boolean).join(', ') || 'a place'}`;
    case 'layers': return `Layers ${[Array.isArray(a.args.on) ? `on: ${(a.args.on as string[]).join(', ')}` : '', Array.isArray(a.args.off) ? `off: ${(a.args.off as string[]).join(', ')}` : ''].filter(Boolean).join(' · ')}`;
    case 'find': return `Find ${g('layer').replace('_', ' ')}${g('text') ? ` “${g('text')}”` : ''}${typeof a.args.near === 'string' ? ` near ${a.args.near}` : ''}`;
    case 'scan': return 'Scan what is in view';
    case 'highlight': return `Mark ${Array.isArray(a.args.points) ? a.args.points.length : 0} places`;
    case 'show': return `Show ${g('title') || 'a list'}`;
    case 'markets': return `Read ${Array.isArray(a.args.symbols) ? (a.args.symbols as string[]).join(', ') : 'the markets'}`;
    case 'open': return `Open ${g('panel')}`;
    case 'map_view': return `Switch to ${[g('projection'), g('style')].filter(Boolean).join(', ')}`;
    case 'forecast': return `Forecast: ${g('question')}`;
    case 'clear': return 'Clear the highlights';
  }
}

/** OI's words: paragraphs, and "- " lines as a list. */
function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (bullets.length) blocks.push(<ul key={`u${k}`} className="flex flex-col gap-0.5 pl-1">{bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="text-[var(--gold-primary)]">·</span><span>{b}</span></li>)}</ul>);
    bullets = [];
  };
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^[-•*]\s+/.test(t)) bullets.push(t.replace(/^[-•*]\s+/, ''));
    else { flush(i); if (t) blocks.push(<p key={i}>{t}</p>); }
  });
  flush(-1);
  return <div className="flex flex-col gap-1.5 text-[12px] leading-[1.6] text-[var(--text-primary)]">{blocks}</div>;
}

function ActionRow({ a }: { a: ActionView }) {
  const color = a.status === 'ok' ? T.gold : a.status === 'error' ? T.red : a.status === 'running' ? T.cyan : T.mute;
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border" style={{ borderColor: 'var(--border-secondary)', color }}>
        {a.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ToolIcon tool={a.tool} className="w-3 h-3" />}
      </span>
      <span className={`flex-1 min-w-0 text-[10.5px] leading-snug ${a.status === 'error' ? 'text-[var(--alert-red)]' : a.status === 'pending' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>
        {a.summary || describe(a)}
      </span>
    </div>
  );
}

function CardView({ card, oi, onLocate, onOpenForecast, onWorkspace }: {
  card: Card; oi: OiClient; onLocate: (lat: number, lng: number, zoom?: number) => void; onOpenForecast: () => void; onWorkspace?: () => void;
}) {
  const [all, setAll] = useState(false);
  if (card.kind === 'forecast') {
    const live = oi.runId === card.runId ? oi.state : null;
    const answer = live ? currentAnswer(live) : '';
    return (
      <div className="rounded-md border border-[var(--border-primary)] p-3 flex flex-col gap-2" style={{ background: gold(0.04) }}>
        <div className="flex items-center gap-2">
          <OiMark size={14} live={live?.status === 'running'} />
          <span className={`${LABEL} !text-[8.5px] text-[var(--gold-primary)]`}>Forecast</span>
          {live && <span className={`${LABEL} !text-[8.5px] text-[var(--text-muted)] truncate`}>{live.status === 'running' ? live.phaseLabel : live.status}</span>}
        </div>
        <p className="text-[11.5px] font-semibold leading-snug text-[var(--text-heading)]">{card.title}</p>
        {answer && <p className="text-[18px] font-mono font-light tabular-nums text-[var(--text-heading)]" style={{ textShadow: `0 0 16px ${gold(0.3)}` }}>{answer}</p>}
        <div className="flex items-center gap-1.5">
          <button onClick={() => { if (card.runId && oi.runId !== card.runId) void oi.watch(card.runId); onOpenForecast(); }} className="btn-tactical flex items-center gap-1.5" style={{ padding: '5px 10px', fontSize: 9.5 }}>
            <Orbit className="w-3 h-3" /> Open forecast
          </button>
          {onWorkspace && live && <button onClick={onWorkspace} className="btn-tactical btn-tactical--cyan flex items-center gap-1.5" style={{ padding: '5px 10px', fontSize: 9.5 }}><ExternalLink className="w-3 h-3" /> Workspace</button>}
        </div>
      </div>
    );
  }
  const shown = all ? card.items : card.items.slice(0, 8);
  return (
    <div className="rounded-md border border-[var(--border-secondary)] bg-black/25 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)]">
        {card.kind === 'markets' ? <TrendingUp className="w-3 h-3 text-[var(--gold-primary)]" /> : card.kind === 'place' ? <MapPin className="w-3 h-3 text-[var(--gold-primary)]" /> : <List className="w-3 h-3 text-[var(--gold-primary)]" />}
        <span className={`${LABEL} !text-[8.5px] text-[var(--text-secondary)] truncate flex-1`}>{card.title}</span>
        {card.subtitle && <span className="text-[9px] font-mono text-[var(--text-muted)]">{card.subtitle}</span>}
      </div>
      {card.items.length === 0 && <p className="px-3 py-2.5 text-[11px] text-[var(--text-muted)]">Nothing matched.</p>}
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {shown.map((it, i) => {
          const placed = it.lat !== undefined && it.lng !== undefined;
          const body = (
            <>
              <span className="w-5 text-[9px] font-mono tabular-nums text-[var(--text-muted)] flex-shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] leading-snug truncate text-[var(--text-primary)]">{it.label}</span>
                {it.detail && <span className="block text-[9.5px] font-mono truncate text-[var(--text-muted)]">{it.detail}</span>}
              </span>
              {it.value && <span className="text-[10.5px] font-mono tabular-nums whitespace-pre flex-shrink-0" style={{ color: it.tone === 'up' ? T.green : it.tone === 'down' ? T.red : T.text }}>{it.value}</span>}
              {placed && <LocateFixed className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--gold-light)]" />}
            </>
          );
          return placed ? (
            <button key={i} onClick={() => onLocate(it.lat!, it.lng!, card.kind === 'place' ? undefined : 8)} title="Fly there"
              className="group flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--hover-accent)]">{body}</button>
          ) : it.url ? (
            <a key={i} href={it.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--hover-accent)]">{body}</a>
          ) : (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5">{body}</div>
          );
        })}
      </div>
      {card.items.length > 8 && (
        <button onClick={() => setAll(v => !v)} className={`w-full h-7 ${LABEL} !text-[8.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)] border-t border-[var(--border-secondary)]`}>
          {all ? 'Show fewer' : `Show all ${card.items.length}`}
        </button>
      )}
    </div>
  );
}

function Turn({ e, oi, onLocate, onOpenForecast, onWorkspace, onRetry }: {
  e: Entry; oi: OiClient; onLocate: (lat: number, lng: number, zoom?: number) => void; onOpenForecast: () => void; onWorkspace?: () => void; onRetry: (text: string, mode: Mode) => void;
}) {
  if (e.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="self-end max-w-[88%] flex flex-col items-end gap-1">
        {e.mode !== 'auto' && <span className={`${LABEL} !text-[7.5px] text-[var(--text-muted)]`}>{e.mode}</span>}
        <div className="rounded-lg rounded-br-sm px-3 py-2 text-[12px] leading-relaxed border" style={{ color: T.text, background: gold(0.09), borderColor: gold(0.28) }}>{e.text}</div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <span className="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
        <OiMark size={13} live={e.busy} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {e.says.map((s, i) => <Prose key={i} text={s} />)}
        {e.actions.length > 0 && (
          <div className="rounded-md border border-[var(--border-secondary)] px-2.5 py-1 bg-white/[0.015]">
            {e.actions.map((a, i) => <ActionRow key={i} a={a} />)}
          </div>
        )}
        {e.cards.map((c, i) => <CardView key={i} card={c} oi={oi} onLocate={onLocate} onOpenForecast={onOpenForecast} onWorkspace={onWorkspace} />)}
        {e.busy && !e.says.length && !e.actions.length && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><Loader2 className="w-3 h-3 animate-spin text-[var(--cyan-primary)]" /> Thinking…</div>
        )}
        {e.error && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--alert-red)]">{e.error}</span>
            {e.retry && <button onClick={() => onRetry(e.retry!.text, e.retry!.mode)} className={`inline-flex items-center gap-1 ${LABEL} !text-[8.5px] text-[var(--text-muted)] hover:text-[var(--gold-light)]`}><RotateCcw className="w-3 h-3" /> Retry</button>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export interface AssistViewProps {
  assist: AssistClient;
  oi: OiClient;
  ready: boolean;
  providerName: string;
  onKey: () => void;
  onSend: (text: string, mode: Mode) => void;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  onOpenForecast: () => void;
  onWorkspace?: () => void;
  speakOn: boolean;
  onSpeak: (on: boolean) => void;
  /** Focus the composer on mount (opened from the keyboard). */
  autoFocus?: boolean;
}

export function AssistView(p: AssistViewProps) {
  const { assist } = p;
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = (t: string, m: Mode = mode) => {
    if (!t.trim() || !p.ready || assist.busy) return;
    p.onSend(t.trim(), m);
    setText('');
  };
  const dictation = useDictation(heard => send(heard));

  useEffect(() => { if (p.autoFocus) input.current?.focus(); }, [p.autoFocus]);
  const last = assist.entries[assist.entries.length - 1];
  const lastSize = last ? (last.role === 'oi' ? last.says.length + last.actions.length + last.cards.length + (last.busy ? 0 : 100) : 1) : 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [assist.entries.length, lastSize]);

  // The textarea grows with what is typed, up to five lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [text]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-1 px-4 pt-4 pb-3 flex flex-col gap-4">
        {assist.entries.length === 0 ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-[var(--gold-primary)]" />
                <h3 className="text-[13px] font-semibold tracking-wide text-[var(--text-heading)]">Ask OI</h3>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                Talk to the map. OI flies you there, switches the layers on, finds what is live, marks it and puts it on screen. It reads the markets, opens panels and runs forecasts, on your own model key.
              </p>
            </div>
            {['Navigate', 'Research', 'Forecast'].map(group => (
              <div key={group}>
                <div className={`${LABEL} !text-[8px] text-[var(--text-muted)] mb-1`}>{group}</div>
                <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
                  {SUGGESTIONS.filter(s => s.group === group).map(s => (
                    <button key={s.text} onClick={() => (p.ready ? send(s.text, s.mode) : setText(s.text))} disabled={assist.busy}
                      className="group flex items-center gap-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      <span className="flex-1">{s.text}</span>
                      <ArrowUp className="w-3 h-3 rotate-45 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--gold-primary)]" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : assist.entries.map(e => (
          <Turn key={e.id} e={e} oi={p.oi} onLocate={p.onLocate} onOpenForecast={p.onOpenForecast} onWorkspace={p.onWorkspace} onRetry={(t, m) => send(t, m)} />
        ))}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 px-3 pt-2 pb-3 border-t border-[var(--border-secondary)] flex flex-col gap-2" style={{ background: 'var(--bg-panel-solid)' }}>
        <Segmented id="assist-mode" size="sm" value={mode} onChange={setMode} options={MODES} />
        {p.ready ? (
          <div className="flex items-end gap-1.5 rounded-lg border border-[var(--border-primary)] bg-black/40 focus-within:border-[var(--border-active)] transition-colors px-2 py-1.5">
            <textarea ref={input} value={dictation.listening ? dictation.heard : text} rows={1}
              onChange={e => setText(e.target.value.slice(0, 2000))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
              placeholder={dictation.listening ? 'Listening…' : mode === 'forecast' ? 'What should the swarm forecast?' : 'Ask OI, or tell it where to go'}
              aria-label="Message to OI" readOnly={dictation.listening}
              className="flex-1 resize-none bg-transparent outline-none text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] py-1 max-h-[110px]" />
            {dictation.supported && (
              <button onClick={() => (dictation.listening ? dictation.stop() : dictation.start())} disabled={assist.busy} aria-pressed={dictation.listening}
                title={dictation.listening ? 'Stop listening' : 'Talk to OI'} aria-label={dictation.listening ? 'Stop listening' : 'Talk to OI'}
                className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-30 ${dictation.listening ? 'text-[var(--alert-red)] bg-[rgba(255,61,61,0.12)] animate-osiris-pulse' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)]'}`}>
                <Mic className="w-4 h-4" />
              </button>
            )}
            {assist.busy ? (
              <button onClick={assist.stop} title="Stop" aria-label="Stop" className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 text-[var(--alert-red)] hover:bg-[rgba(255,61,61,0.1)]"><Square className="w-3.5 h-3.5" /></button>
            ) : (
              <button onClick={() => send(text)} disabled={!text.trim()} title="Send (Enter)" aria-label="Send"
                className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border border-[var(--border-active)] text-[var(--gold-light)] bg-[var(--gold-primary)]/10 hover:bg-[var(--gold-primary)]/20 disabled:opacity-30 disabled:pointer-events-none transition-colors">
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <button onClick={p.onKey} className="btn-tactical btn-tactical--cyan w-full">Add your {shortName(p.providerName)} key to talk to OI</button>
        )}
        <div className="flex items-center gap-2 text-[9px] font-mono tracking-[0.1em] text-[var(--text-muted)]">
          {dictation.error ? <span className="text-[var(--alert-orange)]">{dictation.error}</span> : <span>ENTER TO SEND · SHIFT+ENTER NEW LINE</span>}
          <span className="ml-auto flex items-center gap-0.5">
            {canSpeak() && (
              <button onClick={() => p.onSpeak(!p.speakOn)} aria-pressed={p.speakOn} title={p.speakOn ? 'Stop reading replies aloud' : 'Read replies aloud'}
                className={`h-6 px-1.5 rounded flex items-center gap-1 transition-colors hover:bg-[var(--hover-accent)] ${p.speakOn ? 'text-[var(--gold-light)]' : 'hover:text-[var(--text-primary)]'}`}>
                {p.speakOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />} VOICE
              </button>
            )}
            {assist.entries.length > 0 && (
              <button onClick={assist.clear} title="Start a new conversation" className="h-6 px-1.5 rounded flex items-center gap-1 transition-colors hover:bg-[var(--hover-accent)] hover:text-[var(--text-primary)]">
                <X className="w-3 h-3" /> CLEAR
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
