'use client';
/**
 * OSIRIS OSI: the workspace.
 *
 * Full screen, the run gets a workspace in the manner of an analysis
 * platform: a top bar with the run, its progress, the stage switch and an
 * object search; on the left the assessment (the verdict, then the report or
 * the execution trace); on the right whatever object is selected, or the
 * lists when nothing is; and in the middle the stage: the live globe, the
 * research graph, the timeline of the debate, or the object tables.
 *
 * Keys: 1–4 switch the stage, Ctrl+K (⌘K) or / searches, Esc closes the
 * selected object and then the workspace.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, GanttChart, Globe2, Minimize2, Network, Table2 } from 'lucide-react';
import type { OsiClient } from '@/lib/osi/client';
import { workspaceLayout } from '@/lib/osi/layout';
import { resolve } from '@/lib/osi/research';
import type { RunState } from '@/lib/osi/state';
import { progressOf, traceOf } from '@/lib/osi/trace';
import ErrorBoundary from '@/components/ErrorBoundary';
import { KIND_LABEL, SOLID, T, gold } from './theme';
import { IconButton, OsiMark, Segmented, TextButton } from './atoms';
import { Controls, InjectBox, UsageLine, Verdict } from './run';
import { ReportBody } from './report';
import { ContextList, Legend } from './lists';
import { ObjectView } from './ObjectView';
import { TraceView } from './TraceView';
import { GraphView } from './GraphView';
import { TimelineView } from './TimelineView';
import { TableView } from './TableView';
import { ObjectSearch, type ObjectSearchHandle } from './ObjectSearch';

export type Stage = 'globe' | 'graph' | 'timeline' | 'table';
const STAGES: Stage[] = ['globe', 'graph', 'timeline', 'table'];

export interface WorkspaceProps {
  s: RunState;
  osi: OsiClient;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  onAsk: (agentId: string) => void;
  onTheater?: (on: boolean) => void;
  focus?: boolean;
  onFocus?: () => void;
  following?: boolean;
  onFollow?: () => void;
  /** The debate, panel, world and ask lists, built by the panel so they share its tab state. */
  lists: ReactNode;
  errorBox: ReactNode;
}

function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function Workspace(p: WorkspaceProps) {
  const { s, osi, selected, onSelect } = p;
  const [stage, setStage] = useState<Stage>('globe');
  const [leftTab, setLeftTab] = useState<'assessment' | 'trace' | null>(null);
  const [copied, setCopied] = useState(false);
  const search = useRef<ObjectSearchHandle>(null);
  const L = workspaceLayout(useWindowWidth());
  const selection = resolve(s, selected);
  const progress = useMemo(() => progressOf(traceOf(s)), [s]);
  // Until someone picks: the trace while the run works, the assessment once there is a report.
  const left = leftTab ?? (s.report ? 'assessment' : 'trace');

  const { onTheater } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (selected) onSelect(null);
        else onTheater?.(false);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= STAGES.length) setStage(STAGES[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onSelect, onTheater]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?osi=${osi.runId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const stageBox = { left: L.left + L.gap * 2, right: L.right + L.gap * 2, top: L.top, bottom: L.gap };

  return (
    <div className="fixed inset-0 z-[900] pointer-events-none" role="dialog" aria-label="OSI workspace">
      <div className="absolute inset-x-0 top-0 h-[96px]" style={{ background: 'linear-gradient(to bottom, rgba(4,4,10,0.9) 45%, transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[60px]" style={{ background: 'linear-gradient(to top, rgba(4,4,10,0.8) 40%, transparent)' }} />

      {/* ── Top bar ── */}
      <header className="glass-panel absolute pointer-events-auto flex items-center gap-3 px-3" style={{ left: L.gap, right: L.gap, top: L.gap, height: 56 }}>
        <div className="flex items-center gap-2 flex-shrink-0 pl-1">
          <OsiMark size={18} live={s.status === 'running'} />
          <span className="hud-text text-[12px] text-[var(--text-primary)]">OSI</span>
        </div>
        <span className="w-px h-7 bg-[var(--border-secondary)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold truncate text-[var(--text-heading)]" title={s.question}>{s.question}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[9px] font-mono tracking-[0.12em] uppercase text-[var(--text-muted)] min-w-0">
            {osi.runId && <span className="flex-shrink-0">Run {osi.runId.slice(0, 6)}</span>}
            {s.frame && <span className="flex-shrink-0 text-[var(--cyan-primary)]">{KIND_LABEL[s.frame.kind]}</span>}
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.status === 'running' ? 'animate-osiris-pulse' : ''}`}
                style={{ background: s.status === 'running' ? T.green : s.status === 'done' ? T.gold : s.status === 'failed' ? T.red : T.mute }} />
              <span className="truncate normal-case tracking-[0.04em] text-[var(--text-secondary)]">{s.status === 'running' ? s.phaseLabel : s.status === 'done' ? 'Forecast complete' : s.status === 'failed' ? (s.message || 'Failed') : 'Stopped'}</span>
            </span>
          </div>
        </div>
        <div className="flex-shrink-0" style={{ width: 'min(400px, 30vw)' }}>
          <Segmented id="stage" value={stage} onChange={setStage} options={[
            { value: 'globe', label: 'Globe', icon: <Globe2 className="w-3 h-3" />, title: 'The live globe (1)' },
            { value: 'graph', label: 'Graph', icon: <Network className="w-3 h-3" />, title: 'The research graph (2)' },
            { value: 'timeline', label: 'Timeline', icon: <GanttChart className="w-3 h-3" />, title: 'The debate over time (3)' },
            { value: 'table', label: 'Table', icon: <Table2 className="w-3 h-3" />, title: 'Every object in tables (4)' },
          ]} />
        </div>
        <div className="flex-shrink-0 w-[210px]"><ObjectSearch ref={search} s={s} onPick={k => onSelect(k)} /></div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Controls s={s} osi={osi} focus={p.focus} onFocus={p.onFocus} following={p.following} onFollow={p.onFollow} />
          <TextButton onClick={share} title="Copy a link that replays this run">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Link</TextButton>
          <IconButton title="Leave full screen (Esc)" onClick={() => onTheater?.(false)}><Minimize2 className="w-3.5 h-3.5" /></IconButton>
        </div>
        <span className="absolute left-3 right-3 bottom-0 h-px bg-[var(--border-secondary)] overflow-hidden" aria-hidden>
          <span className="block h-full transition-[width] duration-700" style={{ width: `${progress * 100}%`, background: T.gold, boxShadow: `0 0 8px ${gold(0.8)}` }} />
        </span>
      </header>

      {/* ── Left: the assessment ── */}
      <aside className="glass-panel absolute pointer-events-auto flex flex-col overflow-hidden" style={{ left: L.gap, top: L.top, bottom: L.gap, width: L.left }} aria-label="Assessment">
        <div className="px-4 pt-4 pb-4 border-b border-[var(--border-secondary)] flex flex-col gap-3">
          <Verdict key={osi.runId ?? ''} s={s} large />
          {s.status === 'running' && osi.canSteer && <InjectBox osi={osi} s={s} />}
        </div>
        {p.errorBox}
        <div className="px-3 pt-3">
          <Segmented id="left" size="sm" value={left} onChange={setLeftTab} options={[
            { value: 'assessment', label: s.report ? 'Report' : 'Sources' },
            { value: 'trace', label: 'Trace' },
          ]} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4">
          {left === 'trace' ? <TraceView s={s} />
            : s.report ? <ReportBody s={s} runId={osi.runId} selected={selected} onSelect={onSelect} />
              : <ContextList s={s} selected={selected} onSelect={onSelect} />}
        </div>
        <UsageLine s={s} />
      </aside>

      {/* ── Right: the selected object, or the lists ── */}
      <aside className="glass-panel absolute pointer-events-auto flex flex-col overflow-hidden" style={{ right: L.gap, top: L.top, bottom: L.gap, width: L.right }} aria-label={selection ? 'Object' : 'Lists'}>
        {selection
          ? <ObjectView key={selection.key} s={s} sel={selection} onSelect={onSelect} onLocate={p.onLocate} onAsk={p.onAsk} onGraph={() => setStage('graph')} variant="panel" onBack={() => onSelect(null)} />
          : p.lists}
      </aside>

      {/* ── The stage ── */}
      <AnimatePresence>
        {stage !== 'globe' && (
          <motion.div key={stage} initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.2 }}
            className="glass-panel absolute pointer-events-auto overflow-hidden" style={{ ...stageBox, background: SOLID }}>
            <ErrorBoundary name={`OSI ${stage}`}>
              {stage === 'graph' && <GraphView s={s} selected={selected} onSelect={onSelect} />}
              {stage === 'timeline' && <TimelineView s={s} selected={selected} onSelect={onSelect} />}
              {stage === 'table' && <TableView s={s} selected={selected} onSelect={onSelect} />}
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
      {stage === 'globe' && (
        <div className="absolute flex justify-center pointer-events-none" style={{ left: stageBox.left, right: stageBox.right, bottom: L.gap + 12 }}>
          <div className="pointer-events-auto"><Legend floating compact /></div>
        </div>
      )}
    </div>
  );
}
