'use client';
/**
 * OSIRIS OI: what a panelist quoted, and where from.
 *
 * Under a post, each quote in its own words with the source it came from, a
 * click away: the headline, the passage of the asker's data. A quote found
 * word for word in its source is marked verbatim; one that is not is marked
 * as a paraphrase, so a reader knows which threads hold all the way.
 */
import { BadgeCheck } from 'lucide-react';
import type { RunState } from '@/lib/oi/state';
import type { Citation, ContextItem } from '@/lib/oi/types';
import { LABEL, T } from './theme';
import { TypeIcon } from './atoms';

/** Where a source is from, in a few words: the outlet, the file, the feed. */
export function sourceLabel(c: ContextItem | undefined, id: string): string {
  if (!c) return id;
  if (c.kind === 'data') return c.id === 'data' ? 'Your data' : c.source;
  return c.source || (c.kind === 'quake' ? 'Earthquakes' : c.kind === 'market' ? 'Markets' : 'News');
}

/** Whether a quote was found in its source as quoted. */
export function Verbatim({ exact }: { exact: boolean }) {
  return exact
    ? <span className={`${LABEL} !text-[7.5px] inline-flex items-center gap-0.5`} style={{ color: T.green }} title="Found word for word in the source"><BadgeCheck className="w-2.5 h-2.5" />Verbatim</span>
    : <span className={`${LABEL} !text-[7.5px]`} style={{ color: T.orange }} title="Not found word for word in the source">Paraphrase</span>;
}

export function Quotes({ s, cites, onSelect }: { s: RunState; cites: Citation[] | undefined; onSelect: (key: string | null) => void }) {
  // A run made before quoting has no cites at all; one where the panelist quoted nothing says so.
  if (!cites) return null;
  if (!cites.length) {
    return s.context.length ? <p className={`mt-1.5 ${LABEL} !text-[7.5px] text-[var(--text-muted)]`}>No source quoted</p> : null;
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {cites.map(c => {
        const src = s.context.find(x => x.id === c.source);
        return (
          <button key={c.source} onClick={e => { e.stopPropagation(); onSelect(`c:${c.source}`); }} title={src?.title ?? c.source}
            className="group text-left border-l-2 pl-2.5 py-0.5 rounded-r transition-colors hover:bg-[var(--hover-accent)]"
            style={{ borderColor: c.exact ? 'color-mix(in srgb, var(--alert-green) 55%, transparent)' : 'var(--border-primary)' }}>
            <span className="block text-[11px] leading-snug text-[var(--text-primary)]">“{c.quote}”</span>
            <span className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[9px] font-mono tracking-[0.06em] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
              <TypeIcon k={`c:${c.source}`} subtype={src?.kind} className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{sourceLabel(src, c.source)}</span>
              <span className="flex-shrink-0 opacity-70">[{c.source}]</span>
              <span className="ml-auto flex-shrink-0"><Verbatim exact={c.exact} /></span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
