'use client';
/**
 * OSIRIS OSI: the run as lists: the debate as it happened, the panel, the
 * world model and the live intelligence it read, and a way to question the
 * panel afterwards.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Send, Trash2, Zap } from 'lucide-react';
import type { Engine, OsiClient } from '@/lib/osi/client';
import { latestPosts, type RunState } from '@/lib/osi/state';
import { formatAmount, leader, outcomeColor, positionIn } from '@/lib/osi/forecast';
import { nodeName } from '@/lib/osi/research';
import { rangeOf } from '@/lib/osi/timeline';
import type { ContextItem, Link, Post, RoundStat } from '@/lib/osi/types';
import { FIELD, LABEL, T, ago, cyan, fit, gold, pct, smooth, toneColor } from './theme';
import { Avatar, Empty, Mentions, SectionTitle, ViewTag } from './atoms';
import { ReportBody } from './report';

export type Tab = 'report' | 'debate' | 'panel' | 'world' | 'ask';

export function RunTabs(p: {
  s: RunState; tab: Tab; setTab: (t: Tab) => void; osi: OsiClient; engine: Engine; keyValue: string; ready: boolean;
  selected: string | null; onSelect: (k: string | null) => void; askTarget: string; setAskTarget: (t: string) => void; theater: boolean;
}) {
  const { s, tab, setTab } = p;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    ...(!p.theater && s.report ? [{ id: 'report' as Tab, label: 'Report' }] : []),
    { id: 'debate', label: 'Debate', count: s.posts.length || undefined },
    { id: 'panel', label: 'Panel', count: s.agents.length || undefined },
    { id: 'world', label: 'World', count: s.actors.length || undefined },
    { id: 'ask', label: 'Ask' },
  ];
  const current = tabs.some(t => t.id === tab) ? tab : 'debate';
  return (
    <div className={`flex flex-col ${p.theater ? 'h-full min-h-0' : ''}`}>
      <div role="tablist" className="flex items-stretch px-2 border-b border-[var(--border-secondary)] flex-shrink-0">
        {tabs.map(t => {
          const on = current === t.id;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`relative px-2.5 h-10 text-[9.5px] font-mono tracking-[0.18em] uppercase transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              {t.label}{t.count ? <span className={`ml-1.5 tabular-nums ${on ? 'text-[var(--cyan-primary)]' : ''}`}>{t.count}</span> : null}
              {on && <motion.span layoutId={p.theater ? 'osi-tab-theater' : 'osi-tab'} className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: T.gold, boxShadow: `0 0 10px ${gold(0.7)}` }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            </button>
          );
        })}
      </div>
      <div className={`px-4 py-4 ${p.theater ? 'flex-1 min-h-0 overflow-y-auto styled-scrollbar' : ''}`}>
        {current === 'report' && s.report && <ReportBody s={s} runId={p.osi.runId} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'debate' && <DebateList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'panel' && <PanelList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'world' && <WorldList s={s} selected={p.selected} onSelect={p.onSelect} />}
        {current === 'ask' && <AskBox s={s} osi={p.osi} engine={p.engine} keyValue={p.keyValue} ready={p.ready} target={p.askTarget} setTarget={p.setAskTarget} onSelect={p.onSelect} />}
      </div>
    </div>
  );
}

export function DebateList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const [limit, setLimit] = useState(30);
  const names = useMemo(() => new Map(s.agents.map(a => [a.id, a])), [s.agents]);
  type Item = { kind: 'post'; post: Post } | { kind: 'inject'; text: string; round: number } | { kind: 'round'; stat: RoundStat };
  const items: Item[] = [];
  let pi = 0;
  for (let r = 1; r <= Math.max(s.roundsPlanned, 1); r++) {
    for (const inj of s.injects.filter(x => x.round === r)) items.push({ kind: 'inject', text: inj.text, round: r });
    while (pi < s.posts.length && s.posts[pi].round === r) items.push({ kind: 'post', post: s.posts[pi++] });
    const stat = s.rounds.find(x => x.round === r);
    if (stat) items.push({ kind: 'round', stat });
  }
  while (pi < s.posts.length) items.push({ kind: 'post', post: s.posts[pi++] });
  const shown = items.slice().reverse().slice(0, limit);

  if (!s.agents.length) {
    return <Empty>{s.status === 'running' ? 'The panel is being assembled. On the globe, the actors and their relations are drawing in.' : 'No debate in this run.'}</Empty>;
  }
  const roundLabel = (stat: RoundStat) => s.frame?.kind === 'number' && stat.value ? `MEDIAN ${formatAmount(stat.value.median)}`
    : s.frame?.kind === 'choice' && stat.shares ? `${s.frame.outcomes[leader(stat.shares)]} ${pct(Math.max(...stat.shares))}` : pct(stat.consensus);
  const pick = (key: string) => onSelect(key === selected ? null : key);

  return (
    <div className="flex flex-col gap-3.5">
      {shown.map((it, i) => {
        if (it.kind === 'round') {
          return (
            <div key={`r${it.stat.round}`} className="flex items-center gap-2.5">
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
              <span className="text-[9px] font-mono tracking-[0.16em] uppercase whitespace-nowrap text-[var(--text-muted)]">Round {it.stat.round} · <span className="text-[var(--gold-light)]">{roundLabel(it.stat)}</span></span>
              <span className="flex-1 h-px bg-[var(--border-secondary)]" />
            </div>
          );
        }
        if (it.kind === 'inject') {
          return (
            <div key={`i${i}`} className="rounded-md px-3 py-2 flex items-start gap-2 border" style={{ background: 'rgba(255,149,0,0.06)', borderColor: 'rgba(255,149,0,0.25)' }}>
              <Zap className="w-3.5 h-3.5 mt-px flex-shrink-0 text-[var(--alert-orange)]" />
              <p className="text-[11px] leading-snug text-[var(--text-primary)]"><span className="text-[var(--text-muted)]">Injected before round {it.round} · </span>{it.text}</p>
            </div>
          );
        }
        const p = it.post;
        const a = names.get(p.agent);
        const key = `g:${p.agent}`;
        const on = selected === key;
        return (
          <motion.article key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={`flex gap-2.5 rounded-md -mx-2 px-2 py-1.5 transition-colors ${on ? 'bg-[var(--hover-accent)]' : ''}`}>
            <button onClick={() => pick(key)} aria-label={`Open ${a?.name ?? p.agent}`} className="self-start"><Avatar name={a?.name ?? '?'} ring={on ? 'selected' : undefined} /></button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <button onClick={() => pick(key)} className="text-[11.5px] font-semibold truncate text-[var(--text-heading)] hover:text-[var(--gold-light)]">{a?.name ?? p.agent}</button>
                <span className="text-[10px] truncate text-[var(--text-muted)]">{a?.role}</span>
                <span className="ml-auto"><ViewTag post={p} frame={s.frame} /></span>
              </div>
              <p className="mt-1 text-[11.5px] leading-[1.55] text-[var(--text-secondary)]"><Mentions text={p.text} s={s} onSelect={onSelect} /></p>
              {p.replies.length > 0 && (
                <div className="mt-1.5 pl-2.5 flex flex-col gap-0.5 border-l border-[var(--border-primary)]">
                  {p.replies.map((r, j) => {
                    const linkKey = `link:rp:${p.agent}:${r.to}`;
                    const tone = r.stance === 'agree' ? T.support : r.stance === 'disagree' ? T.oppose : T.neutral;
                    return (
                      <button key={j} onClick={() => pick(linkKey)} className="text-left text-[10.5px] leading-snug text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        <span style={{ color: tone }}>{r.stance === 'agree' ? 'Agrees with' : r.stance === 'disagree' ? 'Disputes' : 'Questions'}</span>{' '}
                        <span className="text-[var(--text-secondary)]">{names.get(r.to)?.name ?? r.to}</span>{r.point && <> · “{r.point}”</>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.article>
        );
      })}
      {items.length > limit && <button onClick={() => setLimit(l => l + 30)} className={`self-center h-7 px-3 rounded-md ${LABEL} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)]`}>Show earlier</button>}
    </div>
  );
}

/** How a panelist moved across the rounds, on the same scale as the rest of the panel. */
export function Spark({ s, agent, on, width = 44 }: { s: RunState; agent: string; on: boolean; width?: number }) {
  if (s.posts.filter(p => p.agent === agent).length < 2) return <span style={{ width }} className="flex-shrink-0" />;
  const last = s.rounds[s.rounds.length - 1]?.shares;
  const lead = last ? leader(last) : 0;
  const [elo, ehi] = rangeOf(s);
  const view = (p: Post) => s.frame?.kind === 'number' ? positionIn(p.estimate?.value ?? NaN, elo, ehi)
    : s.frame?.kind === 'choice' ? p.shares?.[lead] ?? 0 : p.probability;
  const all = s.posts.map(view).filter(Number.isFinite);
  const [lo, hi] = fit(all.length ? all : [0.5], 0.15);
  const vals = s.posts.filter(p => p.agent === agent).map(view);
  const W = width, H = 16;
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (W - 4), H - 2 - ((v - lo) / (hi - lo)) * (H - 4)] as [number, number]);
  return <svg width={W} height={H} aria-hidden className="flex-shrink-0"><path d={smooth(pts)} fill="none" strokeWidth={1.3} strokeLinecap="round" style={{ stroke: on ? T.gold : T.body, opacity: on ? 1 : 0.7 }} /></svg>;
}

export function PanelList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const latest = latestPosts(s);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selected?.startsWith('g:')) refs.current.get(selected.slice(2))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!s.agents.length) return <Empty>The panel has not been assembled yet.</Empty>;
  return (
    <div className="flex flex-col">
      {s.frame?.kind === 'choice' && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 mb-2 text-[9px] font-mono tracking-[0.1em] uppercase text-[var(--text-muted)]">
          {s.frame.outcomes.map((o, i) => <span key={o} className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: outcomeColor(i) }} />{o}</span>)}
        </div>
      )}
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {s.agents.map(a => {
          const post = latest.get(a.id);
          const thinking = a.id in s.thinking;
          const key = `g:${a.id}`;
          const on = selected === key;
          return (
            <button key={a.id} ref={el => { if (el) refs.current.set(a.id, el); }} onClick={() => onSelect(on ? null : key)}
              className={`flex items-center gap-2.5 -mx-2 px-2 py-2 text-left transition-colors hover:bg-[var(--hover-accent)] ${on ? 'bg-[var(--hover-accent)]' : ''}`}>
              <Avatar name={a.name} size={30} ring={on ? 'selected' : thinking ? 'thinking' : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-semibold truncate text-[var(--text-heading)]">{a.name}</span>
                <span className="block text-[10px] truncate text-[var(--text-muted)]">{a.role}{a.place && ` · ${a.place}`}</span>
              </span>
              <Spark s={s} agent={a.id} on={on} />
              {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-[var(--cyan-primary)]" /> : post ? <ViewTag post={post} frame={s.frame} /> : <span className="text-[var(--text-muted)]">—</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** What the arcs (and the graph's edges) mean, in their own Style Studio colours. */
export function Legend({ floating = false, compact = false }: { floating?: boolean; compact?: boolean }) {
  const rows: { label: string; color: string; dash?: string; opacity?: number }[] = [
    { label: compact ? 'Aligned' : 'Aligned · agrees', color: T.support },
    { label: compact ? 'Opposed' : 'Opposed · disputes', color: T.oppose },
    { label: compact ? 'Between' : 'Between · questions', color: T.neutral },
    { label: 'Evidence', color: T.neutral, opacity: 0.55 },
    { label: 'Weighing', color: T.neutral, dash: '4 3' },
  ];
  return (
    <div className={`flex flex-wrap ${floating ? 'glass-panel !rounded-full justify-center gap-x-5 gap-y-1.5 px-5 py-2.5' : 'gap-x-4 gap-y-1.5'}`}>
      {rows.map(r => (
        <span key={r.label} className="inline-flex items-center gap-2 text-[9px] font-mono tracking-[0.12em] uppercase text-[var(--text-secondary)]">
          <svg width="20" height="6" aria-hidden><line x1="1" x2="19" y1="3" y2="3" strokeWidth="2" strokeDasharray={r.dash} strokeLinecap="round" style={{ stroke: r.color, opacity: r.opacity ?? 1 }} /></svg>
          {r.label}
        </span>
      ))}
    </div>
  );
}

export function LineGlyph({ link }: { link: Link }) {
  return (
    <svg width="18" height="6" className="flex-shrink-0" aria-hidden>
      <line x1="1" x2="17" y1="3" y2="3" strokeWidth="2" strokeDasharray={link.kind === 'focus' ? '4 3' : undefined} strokeLinecap="round"
        style={{ stroke: toneColor(link.tone), opacity: link.kind === 'evidence' ? 0.55 : 1 }} />
    </svg>
  );
}

export function Row({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 -mx-2 px-2 py-1.5 rounded text-left transition-colors hover:bg-[var(--hover-accent)] ${on ? 'bg-[var(--hover-accent)]' : ''}`} style={{ width: 'calc(100% + 16px)' }}>
      {children}
    </button>
  );
}

export function WorldList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const relations = s.links.filter(l => l.kind === 'relation');
  if (!s.actors.length) return <Empty>The world model is being mapped.</Empty>;
  const pick = (key: string) => onSelect(selected === key ? null : key);
  return (
    <div className="flex flex-col gap-5">
      <Legend />
      <div>
        <SectionTitle count={s.actors.length}>Actors</SectionTitle>
        {s.actors.map(a => (
          <Row key={a.id} on={selected === `a:${a.id}`} onClick={() => pick(`a:${a.id}`)}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: gold(0.2), boxShadow: `inset 0 0 0 1.5px ${T.gold}` }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-semibold truncate text-[var(--text-heading)]">{a.name}</span>
              <span className="block text-[10px] truncate text-[var(--text-muted)]">{a.role}</span>
            </span>
            <span className="text-[8.5px] font-mono tracking-[0.14em] uppercase text-[var(--text-muted)]">{a.kind}</span>
          </Row>
        ))}
      </div>
      {relations.length > 0 && (
        <div>
          <SectionTitle count={relations.length}>Relations</SectionTitle>
          {relations.map(l => (
            <Row key={l.id} on={selected === `link:${l.id}`} onClick={() => pick(`link:${l.id}`)}>
              <LineGlyph link={l} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] truncate text-[var(--text-primary)]">{nodeName(s, l.from)} <span className="text-[var(--text-muted)]">⇄</span> {nodeName(s, l.to)}</span>
                <span className="block text-[10px] truncate text-[var(--text-muted)]">{l.label}</span>
              </span>
            </Row>
          ))}
        </div>
      )}
      <ContextList s={s} selected={selected} onSelect={onSelect} />
    </div>
  );
}

export function ContextList({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  if (!s.context.length) return s.status === 'running' && !s.actors.length ? <Empty>Reading the live feeds.</Empty> : null;
  const cited = new Set(s.links.filter(l => l.kind === 'evidence').map(l => l.from.slice(2)));
  return (
    <div>
      <SectionTitle count={s.context.length}>Live intelligence</SectionTitle>
      {s.context.map((c: ContextItem) => {
        const key = `c:${c.id}`;
        return (
          <Row key={c.id} on={selected === key} onClick={() => onSelect(selected === key ? null : key)}>
            <span className="self-start mt-[6px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cited.has(c.id) ? T.cyan : 'var(--text-muted)', boxShadow: cited.has(c.id) ? `0 0 6px ${cyan(0.8)}` : undefined }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-snug text-[var(--text-primary)]">{c.title}</span>
              <span className="block mt-0.5 text-[9px] font-mono tracking-[0.08em] truncate text-[var(--text-muted)]">{[c.source, c.place, ago(c.published)].filter(Boolean).join(' · ')}</span>
            </span>
          </Row>
        );
      })}
    </div>
  );
}

export function AskBox({ s, osi, engine, keyValue, ready, target, setTarget, onSelect }: {
  s: RunState; osi: OsiClient; engine: Engine; keyValue: string; ready: boolean; target: string; setTarget: (t: string) => void; onSelect: (k: string | null) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ who: string; text: string; you: boolean }[]>([]);
  const targetName = target === 'report' ? 'The report agent' : s.agents.find(a => a.id === target)?.name ?? target;
  const send = async () => {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setLog(l => [...l, { who: 'You', text: m, you: true }]);
    setMessage('');
    const out = await osi.ask(target, m, engine, keyValue);
    setLog(l => [...l, { who: targetName, text: out.reply ?? out.error ?? '…', you: false }]);
    setBusy(false);
  };
  if (!s.agents.length) return <Empty>The panel can be questioned once it has been assembled.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Who to ask" className={`${FIELD} h-8 px-2 text-[11px]`}>
        <option value="report" disabled={!s.report} style={{ background: '#0C0E1A' }}>The report agent{!s.report ? ' (once the report is written)' : ''}</option>
        {s.agents.map(a => <option key={a.id} value={a.id} style={{ background: '#0C0E1A' }}>{a.name} · {a.role}</option>)}
      </select>
      {log.length === 0 && <Empty>Ask why the forecast landed where it did, what would change a panelist&apos;s mind, or what to watch next. Questions run on your key.</Empty>}
      <div aria-live="polite" className="flex flex-col gap-3">
        {log.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`max-w-[88%] rounded-lg px-3 py-2 text-[11.5px] leading-relaxed border ${m.you ? 'self-end' : 'self-start'}`}
            style={m.you ? { color: T.text, background: gold(0.1), borderColor: gold(0.3) } : { color: T.body, background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border-secondary)' }}>
            {!m.you && <span className={`block mb-1 ${LABEL} !text-[8.5px] text-[var(--cyan-primary)]`}>{m.who}</span>}
            <span className="whitespace-pre-wrap">{m.you ? m.text : <Mentions text={m.text} s={s} onSelect={onSelect} />}</span>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center gap-2 h-9 pl-3 pr-1 rounded-md border border-[var(--border-primary)] bg-black/40 focus-within:border-[var(--border-active)] transition-colors">
        <input value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} onKeyDown={e => e.key === 'Enter' && send()} disabled={!ready || (target === 'report' && !s.report)}
          placeholder={!ready ? 'Add your key to ask' : `Ask ${targetName.replace(/^The /, 'the ')}`} aria-label="Your question to the panel"
          className="flex-1 bg-transparent outline-none text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50" />
        <button onClick={send} disabled={!ready || busy || !message.trim()} aria-label="Send"
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--gold-light)] hover:bg-[var(--hover-accent)] disabled:opacity-30 transition-colors">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function HistoryList({ osi, onPick }: { osi: OsiClient; onPick: (id: string) => void }) {
  return (
    <section className="px-4 py-4">
      <SectionTitle count={osi.history.length || undefined}>Your forecasts</SectionTitle>
      {!osi.history.length && <Empty>Nothing yet. Forecasts you run are listed here, in this browser only. The server keeps a run for a few hours.</Empty>}
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {osi.history.map(h => (
          <div key={h.id} className="group flex items-center gap-3 py-2">
            <button onClick={() => onPick(h.id)} className="flex-1 min-w-0 text-left">
              <span className="block text-[11.5px] truncate text-[var(--text-primary)] transition-colors group-hover:text-[var(--gold-light)]">{h.question}</span>
              <span className="block mt-0.5 text-[9px] font-mono tracking-[0.08em] uppercase text-[var(--text-muted)]">{new Date(h.at).toLocaleString()} · {h.status}</span>
            </button>
            <span className="text-[10.5px] font-mono tabular-nums max-w-[130px] truncate text-[var(--gold-primary)]">{h.answer ?? pct(h.probability)}</span>
            <button onClick={() => osi.forget(h.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-[var(--alert-red)]" aria-label="Remove from history"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
