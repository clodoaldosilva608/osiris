'use client';
/**
 * OSIRIS OI: an object's view.
 *
 * Whatever is selected, from the globe, the graph, the timeline, the table or
 * a list, opens here as an object: its type and identity, its properties, and
 * everything it is linked to, grouped by kind of link, each a way on to the
 * next object. A panelist also shows what they said round by round, with the
 * quotes behind it; a source shows who quoted it and what the report rests on
 * it; a link shows the words and turns it was drawn from. Together they make
 * a thread a reader can follow from the report back to the words it came from.
 */
import { type ReactNode } from 'react';
import { ArrowLeft, LocateFixed, MessageSquare, Network, X } from 'lucide-react';
import { directionWord, postView } from '@/lib/oi/forecast';
import { LINK_LABEL, TYPE_LABEL } from '@/lib/oi/objects';
import { nodeName, postFor, relatedLinks, type Selection } from '@/lib/oi/research';
import type { RunState } from '@/lib/oi/state';
import type { Link, Post } from '@/lib/oi/types';
import { LABEL, T, ago, gold, leanTo, pct, tint, toneColor } from './theme';
import { Avatar, IconButton, Mentions, Overline, TypeIcon, ViewTag, accentFor } from './atoms';
import { LineGlyph } from './lists';
import { PushTag, Quotes, SOURCE_KIND, SourceLink, Verbatim, sourceLabel } from './quotes';
import { evidenceLedger } from '@/lib/oi/sources';

export interface ObjectViewProps {
  s: RunState;
  sel: Selection;
  onSelect: (key: string | null) => void;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  onAsk: (agentId: string) => void;
  /** Open the selection in the graph view, where the workspace has one. */
  onGraph?: () => void;
  /** 'panel' fills a workspace column; 'card' sits inline in the docked panel. */
  variant?: 'panel' | 'card';
  /** Back to whatever the column showed before (the workspace's lists). */
  onBack?: () => void;
}

const TONE_WORD = { support: 'Aligned', oppose: 'Opposed', neutral: 'Between' } as const;

/** A link to another object: its icon and its name. */
function ObjectChip({ s, k, onSelect }: { s: RunState; k: string; onSelect: (k: string | null) => void }) {
  const source = k.startsWith('c:') ? s.context.find(c => `c:${c.id}` === k) : undefined;
  const subtype = k.startsWith('a:') ? s.actors.find(a => `a:${a.id}` === k)?.kind : source?.kind ?? '';
  return (
    <button onClick={() => onSelect(k)} title={nodeName(s, k)}
      className="inline-flex items-center gap-1.5 max-w-full h-6 px-2 rounded border border-[var(--border-secondary)] bg-white/[0.02] text-[11px] text-[var(--text-primary)] hover:border-[var(--border-active)] hover:text-[var(--gold-light)] transition-colors">
      <TypeIcon k={k} subtype={subtype} className="w-3 h-3 flex-shrink-0" style={{ color: accentFor(k) }} />
      <span className="truncate">{nodeName(s, k)}</span>
      {source && <span className="font-mono text-[9px] text-[var(--text-muted)] flex-shrink-0">[{source.id}]</span>}
    </button>
  );
}

/** Whether the words a quote link carries were found in its source. */
const exactOf = (s: RunState, l: Link) =>
  s.posts.find(p => `g:${p.agent}` === l.from && p.round === l.round)?.cites?.find(c => `c:${c.source}` === l.to)?.exact ?? false;

/** Who quoted a source, and in which words: each row opens the quote, with its turn. */
function QuoteRows({ s, links, onSelect }: { s: RunState; links: Link[]; onSelect: (k: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {links.map(l => (
        <button key={l.id} onClick={() => onSelect(`link:${l.id}`)}
          className="group -mx-1.5 px-1.5 py-1.5 rounded text-left transition-colors hover:bg-[var(--hover-accent)]">
          <span className="flex items-center gap-2">
            <Avatar name={nodeName(s, l.from)} size={18} />
            <span className="text-[11px] font-medium truncate text-[var(--text-primary)]">{nodeName(s, l.from)}</span>
            <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-[var(--text-muted)]">round {l.round}</span>
            <span className="ml-auto"><Verbatim exact={exactOf(s, l)} /></span>
          </span>
          <span className="mt-1 block pl-[26px] text-[11px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">“{l.label}”</span>
        </button>
      ))}
    </div>
  );
}

function Props({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 items-baseline">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={`${LABEL} !text-[8.5px] text-[var(--text-muted)] pt-px`}>{k}</dt>
          <dd className="text-[11.5px] leading-snug text-[var(--text-primary)] min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Overline>{label}</Overline>
        {count !== undefined && <span className="text-[9px] font-mono tabular-nums text-[var(--cyan-primary)]">{count}</span>}
        <span className="flex-1 h-px bg-[var(--border-secondary)]" />
      </div>
      {children}
    </section>
  );
}

/** A lean from −1 (NO, lower) to +1 (YES, higher), on a centred track. */
function LeanBar({ lean, words }: { lean: number; words: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative w-24 h-[3px] rounded-full bg-white/[0.08]">
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />
        <span className="absolute -top-[5px] w-[2px] h-[13px] -ml-px rounded-full" style={{ left: `${(0.5 + lean / 2) * 100}%`, background: T.goldLight, boxShadow: `0 0 8px ${gold(0.8)}` }} />
      </span>
      <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-[var(--text-secondary)]">{words}</span>
    </span>
  );
}

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-20 h-[3px] rounded-full overflow-hidden bg-white/[0.08]"><span className="block h-full rounded-full" style={{ width: `${value * 100}%`, background: color }} /></span>
      <span className="text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">{Math.round(value * 100)}</span>
    </span>
  );
}

function PostCard({ s, post, note, onSelect }: { s: RunState; post: Post; note?: string; onSelect: (k: string | null) => void }) {
  const a = s.agents.find(x => x.id === post.agent);
  return (
    <div className="rounded-md border border-[var(--border-secondary)] bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar name={a?.name ?? '?'} size={22} />
        <button onClick={() => onSelect(`g:${post.agent}`)} className="text-[11px] font-semibold truncate text-[var(--text-heading)] hover:text-[var(--gold-light)]">{a?.name ?? post.agent}</button>
        <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-[var(--text-muted)]">{note ?? `round ${post.round}`}</span>
        <span className="ml-auto"><ViewTag post={post} frame={s.frame} /></span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[var(--text-secondary)]"><Mentions text={post.text} s={s} onSelect={onSelect} /></p>
      <Quotes s={s} cites={post.cites} onSelect={onSelect} />
      {post.reasoning && <p className="mt-1 text-[10.5px] italic leading-snug text-[var(--text-muted)]">{post.reasoning}</p>}
      {post.changed && post.changed.toLowerCase() !== 'nothing' && <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Moved by {post.changed.replace(/^\w/, c => c.toLowerCase())}</p>}
    </div>
  );
}

/** A list of links from one object, each with its line, the object at the other end, and what the link says. */
function LinkRows({ s, links, from, onSelect }: { s: RunState; links: Link[]; from: string; onSelect: (k: string | null) => void }) {
  return (
    <div className="flex flex-col">
      {links.map(l => {
        const other = l.from === from ? l.to : l.from;
        return (
          <button key={l.id} onClick={() => onSelect(`link:${l.id}`)}
            className="group flex items-center gap-2.5 -mx-1.5 px-1.5 py-1 rounded text-left transition-colors hover:bg-[var(--hover-accent)]">
            <LineGlyph link={l} />
            <span className="flex-1 min-w-0 text-[11px] truncate text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
              {nodeName(s, other)}{l.label && l.kind !== 'focus' && <span className="text-[var(--text-muted)]"> · {l.label}</span>}
            </span>
            <span className="text-[8.5px] font-mono tracking-[0.12em] uppercase flex-shrink-0" style={{ color: toneColor(l.tone) }}>{TONE_WORD[l.tone]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ObjectView({ s, sel, onSelect, onLocate, onAsk, onGraph, variant = 'card', onBack }: ObjectViewProps) {
  const place = (k: string) => {
    const [prefix, ...rest] = k.split(':');
    const id = rest.join(':');
    const n = prefix === 'a' ? s.actors.find(a => a.id === id) : prefix === 'g' ? s.agents.find(a => a.id === id) : prefix === 'c' ? s.context.find(c => c.id === id) : null;
    return n && n.lat !== null && n.lng !== null ? { lat: n.lat, lng: n.lng } : null;
  };

  let type = '';
  let subtype = '';
  let title: ReactNode = null;
  let accent = accentFor(sel.key);
  let iconSub = '';
  let iconLink: Link['kind'] | undefined;
  let props: [string, ReactNode][] = [];
  let body: ReactNode = null;
  let locate: { lat: number; lng: number; zoom: number } | null = null;
  let inGraph = false;

  switch (sel.type) {
    case 'link': {
      const l = sel.link;
      accent = toneColor(l.tone);
      iconLink = l.kind;
      type = 'Link';
      subtype = LINK_LABEL[l.kind];
      inGraph = true;
      const a = place(l.from), b = place(l.to);
      if (a && b) locate = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2, zoom: 2.2 };
      const fromReport = l.from === 'r:report';
      const verb = l.kind === 'cite' ? (fromReport ? 'rests on' : 'quotes')
        : l.kind === 'relation' ? '⇄' : l.kind === 'evidence' ? '→' : l.kind === 'reply' ? (l.tone === 'support' ? 'agrees with' : l.tone === 'oppose' ? 'disputes' : 'questions') : l.round ? 'weighing' : 'watches';
      const quotedSource = l.kind === 'cite' ? s.context.find(c => `c:${c.id}` === l.to) : undefined;
      title = <>{nodeName(s, l.from)} <span className="font-normal text-[var(--text-muted)]">{verb}</span> {l.kind === 'cite' ? sourceLabel(quotedSource, l.to.slice(2)) : nodeName(s, l.to)}</>;
      const evidenceEffect = s.frame?.kind === 'number' ? (l.tone === 'support' ? 'Points higher' : l.tone === 'oppose' ? 'Points lower' : 'Bears on')
        : l.tone === 'support' ? 'Points toward YES' : l.tone === 'oppose' ? 'Points toward NO' : 'Bears on';
      props = [
        ['Tone', <span key="t" className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: accent }} />{l.kind === 'evidence' ? evidenceEffect : TONE_WORD[l.tone]}</span>],
        ['Strength', <StrengthBar key="s" value={l.strength} color={accent} />],
        ['Round', l.kind === 'cite' && fromReport ? 'The report' : l.round ? `Round ${l.round}` : 'World model'],
        ['From', <ObjectChip key="f" s={s} k={l.from} onSelect={onSelect} />],
        ['To', <ObjectChip key="o" s={s} k={l.to} onSelect={onSelect} />],
      ];
      const said = postFor(s, l);
      const answered = l.kind === 'reply'
        ? s.posts.filter(p => `g:${p.agent}` === l.to && p.round === l.round - 1)[0] ?? s.posts.filter(p => `g:${p.agent}` === l.to && p.round <= l.round).at(-1)
        : undefined;
      const item = l.kind === 'evidence' ? s.context.find(c => `c:${c.id}` === l.from) : undefined;
      body = (
        <>
          {l.kind === 'cite' && !fromReport && (
            <div className="flex flex-col gap-1.5">
              <blockquote className="pl-2.5 text-[12.5px] leading-relaxed text-[var(--text-heading)] border-l-2" style={{ borderColor: accent }}>“{l.label}”</blockquote>
              <span className="pl-3"><Verbatim exact={exactOf(s, l)} /></span>
            </div>
          )}
          {l.kind === 'cite' && quotedSource && (
            <Group label={fromReport ? 'The source' : 'Where it comes from'}>
              <div className="rounded-md border border-[var(--border-secondary)] bg-black/25 px-3 py-2">
                <p className="text-[11.5px] leading-snug text-[var(--text-primary)]">{quotedSource.kind === 'data' && quotedSource.id !== 'data' ? `“${quotedSource.title}”` : quotedSource.title}</p>
                <p className="mt-1 text-[9.5px] font-mono tracking-[0.08em] text-[var(--text-muted)]">{[`[${quotedSource.id}]`, sourceLabel(quotedSource, quotedSource.id), quotedSource.place, ago(quotedSource.published)].filter(Boolean).join(' · ')}</p>
              </div>
            </Group>
          )}
          {l.label && l.kind !== 'focus' && !(l.kind === 'cite' && !fromReport) && (
            <blockquote className="pl-2.5 text-[12px] leading-relaxed text-[var(--text-primary)] border-l-2" style={{ borderColor: accent }}>
              {l.kind === 'reply' ? `“${l.label}”` : l.label}
            </blockquote>
          )}
          {item && <p className="text-[9.5px] font-mono tracking-[0.08em] text-[var(--text-muted)]">{[item.source, item.place, ago(item.published)].filter(Boolean).join(' · ')}</p>}
          {(answered || said) && (
            <Group label={l.kind === 'reply' ? 'The exchange' : 'The turn it came from'}>
              {answered && <PostCard s={s} onSelect={onSelect} post={answered} note={`said · round ${answered.round}`} />}
              {said && <PostCard s={s} onSelect={onSelect} post={said} note={l.kind === 'reply' ? `replied · round ${said.round}` : undefined} />}
            </Group>
          )}
        </>
      );
      break;
    }
    case 'actor': {
      const a = sel.actor;
      type = TYPE_LABEL.actor;
      subtype = a.kind;
      iconSub = a.kind;
      title = a.name;
      inGraph = true;
      if (a.lat !== null && a.lng !== null) locate = { lat: a.lat, lng: a.lng, zoom: 3.5 };
      const touching = s.links.filter(l => l.from === sel.key || l.to === sel.key);
      const rel = touching.filter(l => l.kind === 'relation');
      const ev = touching.filter(l => l.kind === 'evidence');
      const watchers = [...new Set(touching.filter(l => l.kind === 'focus').map(l => l.from))];
      const leanWords = s.frame?.kind === 'number' ? (a.lean > 0.15 ? 'pushes higher' : a.lean < -0.15 ? 'pushes lower' : 'balanced') : a.lean > 0.15 ? 'toward YES' : a.lean < -0.15 ? 'toward NO' : 'balanced';
      props = [
        ['Role', a.role],
        ['Location', a.place],
        ['Lean', s.frame?.kind === 'choice' ? null : <LeanBar key="l" lean={a.lean} words={leanWords} />],
        ['Links', <span key="n" className="font-mono tabular-nums">{touching.length}</span>],
      ];
      body = (
        <>
          {rel.length > 0 && <Group label="Relations" count={rel.length}><LinkRows s={s} links={rel} from={sel.key} onSelect={onSelect} /></Group>}
          {ev.length > 0 && <Group label="Evidence" count={ev.length}><LinkRows s={s} links={ev} from={sel.key} onSelect={onSelect} /></Group>}
          {watchers.length > 0 && (
            <Group label="Weighed by" count={watchers.length}>
              <div className="flex flex-wrap gap-1.5">{watchers.map(k => <ObjectChip key={k} s={s} k={k} onSelect={onSelect} />)}</div>
            </Group>
          )}
        </>
      );
      break;
    }
    case 'agent': {
      const a = sel.agent;
      type = TYPE_LABEL.panelist;
      subtype = a.role;
      title = a.name;
      inGraph = true;
      if (a.lat !== null && a.lng !== null) locate = { lat: a.lat, lng: a.lng, zoom: 3.5 };
      const posts = s.posts.filter(p => p.agent === a.id);
      const last = posts[posts.length - 1];
      const first = posts[0];
      const replies = s.links.filter(l => l.kind === 'reply' && (l.from === sel.key || l.to === sel.key));
      // What moved them: every source they quoted, and which way.
      const moved = evidenceLedger(posts);
      const weighing = s.links.filter(l => l.kind === 'focus' && l.from === sel.key);
      props = [
        ['Role', a.role],
        ['Based in', a.place],
        ['Lens', a.lens],
        ['Watches for', a.bias],
        ['Prior', s.frame?.kind === 'binary' ? <span key="p" className="font-mono">{pct(a.prior)}</span> : null],
        ['Latest', last ? <ViewTag key="v" post={last} frame={s.frame} /> : <span key="v" className="text-[var(--text-muted)]">{a.id in s.thinking ? 'Thinking…' : 'Not spoken yet'}</span>],
        ['Moved', first && last && first !== last ? <span key="m" className="font-mono text-[10.5px] text-[var(--text-secondary)]">{postView(first, s.frame)} → {postView(last, s.frame)}</span> : null],
        ['Confidence', last ? <span key="c" className="font-mono">{pct(last.confidence)}</span> : null],
      ];
      body = (
        <>
          {posts.length > 0 && (
            <Group label="Activity" count={posts.length}>
              <div className="flex flex-col gap-2">{posts.slice().reverse().map(p => <PostCard key={p.id} s={s} onSelect={onSelect} post={p} />)}</div>
            </Group>
          )}
          {moved.length > 0 && (
            <Group label="What moved them" count={moved.length}>
              <div className="flex flex-col">
                {moved.map(r => {
                  const c = s.context.find(x => x.id === r.source);
                  const last = posts.flatMap(p => p.cites ?? []).filter(x => x.source === r.source).at(-1);
                  return (
                    <div key={r.source} className="flex items-center gap-2 -mx-1.5 px-1.5 py-1 rounded hover:bg-[var(--hover-accent)]">
                      <button onClick={() => onSelect(`c:${r.source}`)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                        <TypeIcon k={`c:${r.source}`} subtype={c?.kind} className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)]" />
                        <span className="text-[11px] truncate text-[var(--text-secondary)]">{c?.title ?? r.source}</span>
                      </button>
                      {last && <PushTag c={last} frame={s.frame} />}
                      <span className="text-[9px] font-mono tabular-nums text-[var(--text-muted)]">{r.quoted}×</span>
                      <SourceLink url={c?.url} />
                    </div>
                  );
                })}
              </div>
            </Group>
          )}
          {replies.length > 0 && <Group label="Exchanges" count={replies.length}><LinkRows s={s} links={replies} from={sel.key} onSelect={onSelect} /></Group>}
          {weighing.length > 0 && <Group label="Weighing" count={weighing.length}><LinkRows s={s} links={weighing} from={sel.key} onSelect={onSelect} /></Group>}
          <button onClick={() => onAsk(a.id)} className="btn-tactical btn-tactical--cyan self-start flex items-center gap-2" style={{ padding: '6px 12px', fontSize: 10 }}>
            <MessageSquare className="w-3 h-3" /> Ask {/^Agent \d+$/.test(a.name) ? a.name : a.name.split(' ')[0]}
          </button>
        </>
      );
      break;
    }
    case 'context': {
      const c = sel.item;
      type = TYPE_LABEL.source;
      subtype = SOURCE_KIND[c.kind] ?? c.kind;
      iconSub = c.kind;
      title = c.kind === 'data' && c.id !== 'data' ? `“${c.title}”` : c.title;
      if (c.lat !== null && c.lng !== null) locate = { lat: c.lat, lng: c.lng, zoom: 4 };
      const bears = s.links.filter(l => l.kind === 'evidence' && l.from === sel.key);
      const quotedBy = s.links.filter(l => l.kind === 'cite' && l.to === sel.key && l.from.startsWith('g:')).sort((a, b) => a.round - b.round);
      const inReport = s.links.filter(l => l.kind === 'cite' && l.to === sel.key && l.from === 'r:report');
      inGraph = bears.length + quotedBy.length + inReport.length > 0;
      props = [
        ['Id', <span key="i" className="font-mono">[{c.id}]</span>],
        [c.kind === 'data' ? 'From' : 'Source', <span key="s" className="inline-flex items-center gap-1.5">{sourceLabel(c, c.id)}<SourceLink url={c.url} /></span>],
        ['Location', c.place],
        ['Published', c.published ? `${new Date(c.published).toLocaleString()} · ${ago(c.published)}` : ''],
        ['Quoted', quotedBy.length ? <span key="q" className="font-mono tabular-nums">{quotedBy.length}× by {new Set(quotedBy.map(l => l.from)).size} panelist{new Set(quotedBy.map(l => l.from)).size === 1 ? '' : 's'}</span> : null],
      ];
      body = (
        <>
          {c.excerpt && (
            <Group label="What it says">
              <blockquote className="pl-2.5 border-l-2 border-[var(--border-primary)] text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{c.excerpt}</blockquote>
            </Group>
          )}
          {c.url && (
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow"
              className="self-start inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--border-primary)] text-[10px] font-mono tracking-[0.12em] uppercase text-[var(--text-secondary)] hover:text-[var(--cyan-primary)] hover:border-[var(--border-active)] transition-colors">
              Open the {c.kind === 'wiki' ? 'article on Wikipedia' : c.kind === 'web' ? 'article' : 'source'} ↗
            </a>
          )}
          {inReport.length > 0 && (
            <Group label="The report rests on it" count={inReport.length}>
              <div className="flex flex-col gap-1">
                {inReport.map(l => (
                  <button key={l.id} onClick={() => onSelect(`link:${l.id}`)} className="group flex items-start gap-2 -mx-1.5 px-1.5 py-1 rounded text-left hover:bg-[var(--hover-accent)]">
                    <TypeIcon k="r:report" className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: T.goldLight }} />
                    <span className="text-[11px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{l.label}</span>
                  </button>
                ))}
              </div>
            </Group>
          )}
          {quotedBy.length > 0 && <Group label="Quoted by" count={quotedBy.length}><QuoteRows s={s} links={quotedBy} onSelect={onSelect} /></Group>}
          {bears.length > 0 && <Group label="Cited against" count={bears.length}><LinkRows s={s} links={bears} from={sel.key} onSelect={onSelect} /></Group>}
          {!inGraph && <p className="text-[11px] text-[var(--text-muted)]">Read by the panel; nobody quoted it.</p>}
        </>
      );
      break;
    }
    case 'scenario': {
      const sc = sel.scenario;
      type = TYPE_LABEL.scenario;
      title = sc.name;
      if (sc.lat !== null && sc.lng !== null) locate = { lat: sc.lat, lng: sc.lng, zoom: 4 };
      props = [['Probability', <span key="p" className="font-mono text-[var(--gold-light)]">{pct(sc.probability)}</span>], ['Plays out in', sc.place]];
      body = <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]"><Mentions text={sc.description} s={s} onSelect={onSelect} /></p>;
      break;
    }
    case 'report': {
      const r = sel.report;
      type = TYPE_LABEL.report;
      subtype = `${r.confidence} confidence`;
      title = r.headline;
      inGraph = s.links.some(l => l.from === sel.key);
      const used = [...new Set(r.drivers.flatMap(d => d.sources ?? []))];
      props = [
        ['Answer', <span key="a" className="font-mono text-[var(--gold-light)]">{r.answer}</span>],
        ['Sources', used.length ? <span key="s" className="font-mono tabular-nums">{used.length}</span> : null],
      ];
      body = (
        <>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]"><Mentions text={r.summary} s={s} onSelect={onSelect} /></p>
          {r.drivers.length > 0 && (
            <Group label="Drivers, and what they rest on" count={r.drivers.length}>
              <div className="flex flex-col gap-2.5">
                {r.drivers.map((d, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] leading-snug text-[var(--text-primary)]">{d.text}</span>
                    {(d.sources?.length ?? 0) > 0
                      ? <div className="flex flex-wrap gap-1.5">{d.sources!.map(id => <ObjectChip key={id} s={s} k={`c:${id}`} onSelect={onSelect} />)}</div>
                      : <span className={`${LABEL} !text-[7.5px] text-[var(--text-muted)]`}>No source given</span>}
                  </div>
                ))}
              </div>
            </Group>
          )}
        </>
      );
      break;
    }
    case 'signpost': {
      const sp = sel.signpost;
      type = TYPE_LABEL.signpost;
      title = sp.text;
      if (sp.lat !== null && sp.lng !== null) locate = { lat: sp.lat, lng: sp.lng, zoom: 4.5 };
      props = [
        ['If it happens', <span key="m" className="font-mono uppercase text-[10px] tracking-[0.1em]" style={{ color: leanTo(s.frame, sp.means, sp.favors) }}>{directionWord(s.frame, sp.means, sp.favors)}</span>],
        ['Where', sp.place],
      ];
      break;
    }
  }

  const lit = relatedLinks(s, sel.key).size;
  const actions = (
    <>
      {locate && <IconButton title="Show on the globe" onClick={() => onLocate(locate!.lat, locate!.lng, locate!.zoom)}><LocateFixed className="w-3.5 h-3.5" /></IconButton>}
      {onGraph && inGraph && <IconButton title="Show in the graph" onClick={onGraph}><Network className="w-3.5 h-3.5" /></IconButton>}
      <IconButton title="Close" onClick={() => onSelect(null)}><X className="w-3.5 h-3.5" /></IconButton>
    </>
  );
  const header = (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 border" style={{ color: accent, borderColor: tint(accent, 45), background: tint(accent, 12) }}>
        <TypeIcon k={sel.key} subtype={iconSub} link={iconLink} className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-[13.5px] font-semibold leading-snug text-[var(--text-heading)] break-words">{title}</h4>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`${LABEL} !text-[8.5px]`} style={{ color: accent }}>{type}</span>
          {subtype && <span className={`${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>· {subtype}</span>}
          {lit > 1 && <span className={`${LABEL} !text-[8.5px] text-[var(--text-muted)]`}>· {lit} links</span>}
        </div>
      </div>
      {variant === 'card' && <div className="flex items-center -mr-1.5 -mt-1">{actions}</div>}
    </div>
  );
  const content = (
    <>
      {header}
      <Props rows={props} />
      {body}
    </>
  );

  if (variant === 'panel') {
    return (
      <div className="flex flex-col h-full min-h-0" aria-label={`${type}: ${typeof title === 'string' ? title : ''}`}>
        <div className="flex items-center gap-1 h-10 px-2 border-b border-[var(--border-secondary)] flex-shrink-0 relative">
          <span className="absolute inset-x-0 top-0 h-px" style={{ background: accent, opacity: 0.8 }} />
          {onBack && <button onClick={onBack} className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md ${LABEL} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)]`}><ArrowLeft className="w-3 h-3" /> Lists</button>}
          <span className={`ml-1 ${LABEL} text-[var(--text-secondary)]`}>Object</span>
          <span className="ml-auto flex items-center">{actions}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4 flex flex-col gap-4">{content}</div>
      </div>
    );
  }

  // In a column or the phone drawer a new selection can sit below the fold: bring it into view.
  const bringIntoView = (el: HTMLElement | null) => {
    if (!el || el.dataset.key === sel.key) return;
    el.dataset.key = sel.key;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return (
    <section ref={bringIntoView} className="relative overflow-hidden flex flex-col gap-3 rounded-lg border border-[var(--border-primary)] p-3.5" style={{ background: gold(0.03) }}>
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: accent, opacity: 0.8 }} />
      {content}
    </section>
  );
}

