'use client';
/**
 * OSIRIS OI: the table view.
 *
 * Every object of a kind in one sortable table: the panelists with how they
 * moved, the actors with how connected they are, the sources with what cited
 * them, and every link. A row opens its object.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { formatAmount, postView } from '@/lib/oi/forecast';
import { LINK_LABEL } from '@/lib/oi/objects';
import { nodeName } from '@/lib/oi/research';
import type { RunState } from '@/lib/oi/state';
import { LABEL, SOLID, T, ago, pct, toneColor } from './theme';
import { Empty, Segmented, TypeIcon, ViewTag, accentFor } from './atoms';
import { Spark } from './lists';
import { SOURCE_KIND } from './quotes';

type Kind = 'panelists' | 'actors' | 'sources' | 'links';

interface Column<R> {
  id: string;
  label: string;
  /** CSS grid track. */
  width: string;
  align?: 'right';
  sort: (r: R) => number | string;
  cell: (r: R) => ReactNode;
}

interface TableSpec<R> { rows: R[]; key: (r: R) => string; text: (r: R) => string; columns: Column<R>[] }

const num = (v: ReactNode) => <span className="font-mono tabular-nums">{v}</span>;

function NameCell({ k, subtype, title, sub }: { k: string; subtype?: string; title: string; sub?: string }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <TypeIcon k={k} subtype={subtype} className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentFor(k) }} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-[var(--text-heading)]">{title}</span>
        {sub && <span className="block truncate text-[9.5px] text-[var(--text-muted)]">{sub}</span>}
      </span>
    </span>
  );
}

function specs(s: RunState) {
  const touching = (k: string) => s.links.filter(l => l.from === k || l.to === k);
  const panelists: TableSpec<RunState['agents'][number]> = {
    rows: s.agents, key: a => `g:${a.id}`, text: a => `${a.name} ${a.role} ${a.place}`,
    columns: [
      { id: 'name', label: 'Panelist', width: 'minmax(170px,2fr)', sort: a => a.name, cell: a => <NameCell k={`g:${a.id}`} title={a.name} sub={a.role} /> },
      { id: 'place', label: 'Location', width: 'minmax(90px,1fr)', sort: a => a.place, cell: a => <span className="truncate text-[var(--text-secondary)]">{a.place || '—'}</span> },
      { id: 'prior', label: 'Prior', width: '62px', align: 'right', sort: a => a.prior, cell: a => num(s.frame?.kind === 'binary' ? pct(a.prior) : '—') },
      {
        id: 'latest', label: 'Latest', width: 'minmax(92px,1fr)', sort: a => { const p = s.posts.filter(x => x.agent === a.id).at(-1); return p ? (p.estimate?.value ?? p.shares?.[0] ?? p.probability) : -Infinity; },
        cell: a => {
          const p = s.posts.filter(x => x.agent === a.id).at(-1);
          if (!p) return <span className="text-[var(--text-muted)]">—</span>;
          // A number's range would crowd the column: the estimate, with the range on hover.
          return s.frame?.kind === 'number' && p.estimate
            ? <span className="font-mono tabular-nums text-[var(--text-primary)]" title={postView(p, s.frame)}>{formatAmount(p.estimate.value)}</span>
            : <ViewTag post={p} frame={s.frame} />;
        },
      },
      { id: 'path', label: 'Path', width: '64px', sort: a => s.posts.filter(x => x.agent === a.id).length, cell: a => <Spark s={s} agent={a.id} on={false} width={52} /> },
      { id: 'conf', label: 'Conf.', width: '58px', align: 'right', sort: a => s.posts.filter(x => x.agent === a.id).at(-1)?.confidence ?? -1, cell: a => num(pct(s.posts.filter(x => x.agent === a.id).at(-1)?.confidence)) },
      { id: 'replies', label: 'Replies', width: '62px', align: 'right', sort: a => s.posts.filter(x => x.agent === a.id).reduce((n, p) => n + p.replies.length, 0), cell: a => num(s.posts.filter(x => x.agent === a.id).reduce((n, p) => n + p.replies.length, 0)) },
    ],
  };
  const actors: TableSpec<RunState['actors'][number]> = {
    rows: s.actors, key: a => `a:${a.id}`, text: a => `${a.name} ${a.kind} ${a.role} ${a.place}`,
    columns: [
      { id: 'name', label: 'Actor', width: 'minmax(170px,2fr)', sort: a => a.name, cell: a => <NameCell k={`a:${a.id}`} subtype={a.kind} title={a.name} sub={a.role} /> },
      { id: 'kind', label: 'Type', width: '96px', sort: a => a.kind, cell: a => <span className={`${LABEL} !text-[8.5px] text-[var(--text-secondary)]`}>{a.kind}</span> },
      { id: 'place', label: 'Location', width: 'minmax(90px,1fr)', sort: a => a.place, cell: a => <span className="truncate text-[var(--text-secondary)]">{a.place || '—'}</span> },
      {
        id: 'lean', label: 'Lean', width: '70px', align: 'right', sort: a => a.lean,
        cell: a => s.frame?.kind === 'choice' ? num('—') : <span className="font-mono tabular-nums" style={{ color: a.lean > 0.15 ? T.gold : a.lean < -0.15 ? T.cyan : T.body }}>{a.lean > 0 ? '+' : ''}{a.lean.toFixed(2)}</span>,
      },
      { id: 'links', label: 'Links', width: '56px', align: 'right', sort: a => touching(`a:${a.id}`).length, cell: a => num(touching(`a:${a.id}`).length) },
      { id: 'evidence', label: 'Evidence', width: '70px', align: 'right', sort: a => touching(`a:${a.id}`).filter(l => l.kind === 'evidence').length, cell: a => num(touching(`a:${a.id}`).filter(l => l.kind === 'evidence').length) },
      { id: 'weighed', label: 'Weighed', width: '68px', align: 'right', sort: a => touching(`a:${a.id}`).filter(l => l.kind === 'focus').length, cell: a => num(touching(`a:${a.id}`).filter(l => l.kind === 'focus').length) },
    ],
  };
  const sources: TableSpec<RunState['context'][number]> = {
    rows: s.context, key: c => `c:${c.id}`, text: c => `${c.title} ${c.source} ${c.place}`,
    columns: [
      { id: 'title', label: 'Source', width: 'minmax(220px,3fr)', sort: c => c.title, cell: c => <NameCell k={`c:${c.id}`} subtype={c.kind} title={c.title} sub={c.source} /> },
      { id: 'kind', label: 'Kind', width: '84px', sort: c => c.kind, cell: c => <span className={`${LABEL} !text-[8.5px] text-[var(--text-secondary)]`}>{SOURCE_KIND[c.kind] ?? c.kind}</span> },
      { id: 'place', label: 'Location', width: 'minmax(80px,1fr)', sort: c => c.place, cell: c => <span className="truncate text-[var(--text-secondary)]">{c.place || '—'}</span> },
      { id: 'age', label: 'Age', width: '64px', align: 'right', sort: c => Date.parse(c.published) || 0, cell: c => num(ago(c.published) || '—') },
      { id: 'cited', label: 'Cited', width: '54px', align: 'right', sort: c => touching(`c:${c.id}`).length, cell: c => num(touching(`c:${c.id}`).length || '—') },
    ],
  };
  const links: TableSpec<RunState['links'][number]> = {
    rows: s.links, key: l => `link:${l.id}`, text: l => `${nodeName(s, l.from)} ${nodeName(s, l.to)} ${l.kind} ${l.label}`,
    columns: [
      { id: 'from', label: 'From', width: 'minmax(120px,1.4fr)', sort: l => nodeName(s, l.from), cell: l => <span className="truncate text-[var(--text-primary)]">{nodeName(s, l.from)}</span> },
      {
        id: 'kind', label: 'Link', width: '108px', sort: l => `${l.kind}${l.tone}`,
        cell: l => (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-[2px] rounded-full" style={{ background: toneColor(l.tone), opacity: l.kind === 'evidence' ? 0.6 : 1 }} />
            <span className={`${LABEL} !text-[8.5px]`} style={{ color: toneColor(l.tone) }}>{LINK_LABEL[l.kind]}</span>
          </span>
        ),
      },
      { id: 'to', label: 'To', width: 'minmax(120px,1.4fr)', sort: l => nodeName(s, l.to), cell: l => <span className="truncate text-[var(--text-primary)]">{nodeName(s, l.to)}</span> },
      { id: 'strength', label: 'Str.', width: '52px', align: 'right', sort: l => l.strength, cell: l => num(Math.round(l.strength * 100)) },
      { id: 'round', label: 'Rnd', width: '46px', align: 'right', sort: l => l.round, cell: l => num(l.round || 'W') },
      { id: 'label', label: 'Says', width: 'minmax(140px,2fr)', sort: l => l.label, cell: l => <span className="truncate text-[var(--text-muted)]">{l.kind === 'focus' ? '—' : l.label || '—'}</span> },
    ],
  };
  return { panelists, actors, sources, links };
}

function Table<R>({ spec, selected, onSelect, query }: { spec: TableSpec<R>; selected: string | null; onSelect: (k: string | null) => void; query: string }) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const template = spec.columns.map(c => c.width).join(' ');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q ? spec.rows.filter(r => spec.text(r).toLowerCase().includes(q)) : spec.rows;
    if (!sort) return hit;
    const col = spec.columns.find(c => c.id === sort.id);
    if (!col) return hit;
    return hit.slice().sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [spec, sort, query]);

  return (
    <div role="table" className="min-w-[560px]">
      <div role="row" className="grid sticky top-0 z-10 border-b border-[var(--border-primary)]" style={{ gridTemplateColumns: template, background: SOLID }}>
        {spec.columns.map(c => {
          const on = sort?.id === c.id;
          return (
            <button key={c.id} role="columnheader" aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
              onClick={() => setSort(on ? (sort!.dir === 1 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 })}
              className={`flex items-center gap-1 px-3 h-8 ${LABEL} !text-[8.5px] transition-colors hover:text-[var(--text-primary)] ${c.align === 'right' ? 'justify-end' : ''} ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-muted)]'}`}>
              {c.label}{on && (sort!.dir === 1 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
            </button>
          );
        })}
      </div>
      {rows.map(r => {
        const k = spec.key(r);
        const on = selected === k;
        return (
          <button key={k} role="row" onClick={() => onSelect(on ? null : k)} aria-selected={on}
            className={`grid w-full items-center text-left text-[11px] border-b border-[var(--border-secondary)] transition-colors hover:bg-[var(--hover-accent)] ${on ? 'bg-[var(--hover-accent)]' : ''}`}
            style={{ gridTemplateColumns: template, boxShadow: on ? `inset 2px 0 0 ${T.gold}` : undefined }}>
            {spec.columns.map(c => (
              <span key={c.id} role="cell" className={`px-3 py-2 min-w-0 overflow-hidden flex items-center ${c.align === 'right' ? 'justify-end' : ''}`}>{c.cell(r)}</span>
            ))}
          </button>
        );
      })}
      {!rows.length && <Empty>{query ? 'Nothing matches the filter.' : 'Nothing here yet.'}</Empty>}
    </div>
  );
}

export function TableView({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (k: string | null) => void }) {
  const [kind, setKind] = useState<Kind>('panelists');
  const [query, setQuery] = useState('');
  const all = useMemo(() => specs(s), [s]);
  const counts: Record<Kind, number> = { panelists: s.agents.length, actors: s.actors.length, sources: s.context.length, links: s.links.length };
  // On a narrow stage the tabs drop their counts (the title above still has the current one).
  const head = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 620));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="h-full flex flex-col">
      <div ref={head} className="flex items-center gap-3 px-4 pt-3 pb-3 border-b border-[var(--border-secondary)]">
        <div className={narrow ? 'hidden' : ''}>
          <div className="hud-text text-[10px] text-[var(--gold-primary)]">Objects</div>
          <div className="mt-0.5 text-[9px] font-mono tracking-[0.14em] text-[var(--text-muted)]">{counts[kind]} {kind.toUpperCase()}</div>
        </div>
        <div className="flex-1 min-w-0 max-w-[460px]">
          <Segmented id="table" size="sm" value={kind} onChange={k => { setKind(k); setQuery(''); }} options={(Object.keys(counts) as Kind[]).map(k => ({ value: k, label: narrow ? k : `${k} ${counts[k]}`, title: `${counts[k]} ${k}` }))} />
        </div>
        <label className={`ml-auto relative flex-shrink-0 ${narrow ? 'w-28' : 'w-44'}`}>
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter rows" aria-label="Filter rows"
            className="w-full h-7 pl-7 pr-2 rounded-md bg-black/40 border border-[var(--border-secondary)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)]" />
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-auto styled-scrollbar">
        {kind === 'panelists' && <Table spec={all.panelists} selected={selected} onSelect={onSelect} query={query} />}
        {kind === 'actors' && <Table spec={all.actors} selected={selected} onSelect={onSelect} query={query} />}
        {kind === 'sources' && <Table spec={all.sources} selected={selected} onSelect={onSelect} query={query} />}
        {kind === 'links' && <Table spec={all.links} selected={selected} onSelect={onSelect} query={query} />}
      </div>
    </div>
  );
}

