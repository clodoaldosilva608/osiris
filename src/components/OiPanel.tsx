'use client';
/**
 * OSIRIS OI: the panel.
 *
 * Two ways to use OI, on the reader's own model key. Forecast (the default)
 * is the swarm: set up an engine, ask, follow the run, read the report and
 * question the panel. Assist is a conversation: talk to OI and it works the
 * map for you (flies there, switches layers, finds what is live, marks it,
 * puts it on screen, starts forecasts, drives the workspace).
 *
 * Full screen, with or without a run, it opens the OI workspace
 * (oi/Workspace): the same Forecast / Assist column on the left, the globe,
 * research graph, timeline and object tables in the middle, and the run's
 * lists and object views on the right. Whatever is selected, from the globe,
 * the graph or a list, opens as that object.
 *
 * It wears the platform's own theme (oi/theme), so it is gold and cyan in
 * Core and violet in Ghost. The run itself lives in the page (useOi), so
 * closing this panel leaves the globe drawing.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { History, Maximize2, MessageSquare, Orbit, Plus, X } from 'lucide-react';
import { PROVIDERS, providerInfo } from '@/lib/oi/providers';
import { loadEngine, loadKey, type Engine, type OiClient } from '@/lib/oi/client';
import { resolve } from '@/lib/oi/research';
import { T, LABEL } from './oi/theme';
import { IconButton, OiMark, Segmented } from './oi/atoms';
import { AssistView } from './oi/assist/AssistView';
import type { AssistClient } from '@/lib/oi/assist/client';
import { AskForm, EnginePill, EngineSheet } from './oi/engine';
import { InjectBox, RunHead, UsageLine, Verdict } from './oi/run';
import { HistoryList, RunTabs, type Tab } from './oi/lists';
import { ObjectView } from './oi/ObjectView';
import { Workspace, type Stage } from './oi/Workspace';

export interface OiPanelProps {
  oi: OiClient;
  /** What is selected: a node key, or "link:<id>" for an arc. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  onLocate: (lat: number, lng: number, zoom?: number) => void;
  onClose?: () => void;
  /** Inside another container (the phone drawer): no frame of its own, no full screen. */
  embedded?: boolean;
  /** Whether the other map layers are hidden so the analysis stands out, and the switch for it. */
  focus?: boolean;
  onFocus?: () => void;
  /** Full screen: the workspace. */
  theater?: boolean;
  onTheater?: (on: boolean) => void;
  /** Whether the camera is following the run, and the way to ask it to. */
  following?: boolean;
  onFollow?: () => void;
  /** The conversation (it lives in the page, so closing the panel keeps it). */
  assist: AssistClient;
  /** Which way of using OI is showing. */
  mode: OiMode;
  onMode: (m: OiMode) => void;
  /** Read OI's replies aloud. */
  speakOn: boolean;
  onSpeak: (on: boolean) => void;
  /** Put the cursor in the conversation's box when the panel opens. */
  autoFocus?: boolean;
  /** What the workspace's stage shows (globe, graph, timeline, table). */
  stage: Stage;
  onStage: (s: Stage) => void;
}

export type OiMode = 'forecast' | 'assist';

/** The engine this browser last used, or OpenAI with its default model. */
function initialEngine(): Engine {
  const saved = loadEngine();
  if (saved && PROVIDERS.some(p => p.id === saved.provider)) return saved;
  return { provider: 'openai', model: providerInfo('openai').defaultModel, remember: false };
}

export default function OiPanel(props: OiPanelProps) {
  const { oi, selected, onSelect, embedded = false, theater = false } = props;
  // Settings come from this browser's storage. The panel only renders once opened, on the client.
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [key, setKey] = useState(() => loadKey(initialEngine().provider));
  const [engineOpen, setEngineOpen] = useState(() => {
    const e = initialEngine();
    return providerInfo(e.provider).needsKey && !loadKey(e.provider);
  });
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [askTarget, setAskTarget] = useState('report');

  const s = oi.state;
  const info = providerInfo(engine.provider);
  const ready = !info.needsKey || key.length > 0;
  const selection = s ? resolve(s, selected) : null;
  // Until someone picks a tab: the debate while it runs, the report once there is one.
  const activeTab: Tab = tab ?? (s?.report ? 'report' : 'debate');

  // Asking a panelist opens the Ask list; in the workspace that means stepping back from the object to the lists.
  const askAgent = (id: string) => { setAskTarget(id); setTab('ask'); if (theater) onSelect(null); };
  const reset = () => { oi.clear(); onSelect(null); setShowHistory(false); setTab(null); };

  const errorBox = oi.error ? (
    <div role="alert" className="mx-4 mt-3 rounded-md px-3 py-2 text-[11px] leading-snug flex items-start gap-2 border" style={{ color: T.text, background: 'rgba(255,61,61,0.07)', borderColor: 'rgba(255,61,61,0.3)' }}>
      <span className="flex-1">{oi.error}</span>
      <button onClick={() => oi.setError('')} className="text-[var(--text-muted)] hover:text-white" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
    </div>
  ) : null;

  const tabs = s ? (
    <RunTabs
      s={s} tab={activeTab} setTab={setTab} oi={oi} engine={engine} keyValue={key} ready={ready}
      selected={selected} onSelect={onSelect} askTarget={askTarget} setAskTarget={setAskTarget} theater={theater}
    />
  ) : null;

  const assistView = (
    <AssistView assist={props.assist} oi={oi} ready={ready} providerName={info.name} onKey={() => setEngineOpen(true)}
      onSend={(text, m) => void props.assist.send(text, m, { engine, key })}
      onLocate={props.onLocate} onOpenForecast={() => props.onMode('forecast')}
      onWorkspace={!embedded && !theater && props.onTheater ? () => props.onTheater?.(true) : undefined}
      speakOn={props.speakOn} onSpeak={props.onSpeak} autoFocus={props.autoFocus} />
  );

  const askForm = (
    <AskForm ready={ready} providerName={info.name} onKey={() => setEngineOpen(true)} onRun={async (input) => {
      const id = await oi.start(input, engine, key);
      if (id) { setShowHistory(false); setTab(null); onSelect(null); }
      return Boolean(id);
    }} />
  );

  /* ── Full screen: the workspace, with or without a run ── */
  if (theater && !embedded) {
    const engineMenu = (
      <div className="relative">
        <EnginePill engine={engine} ready={ready} open={engineOpen} onClick={() => setEngineOpen(v => !v)} />
        <AnimatePresence>
          {engineOpen && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
              className="absolute right-0 top-[calc(100%+10px)] w-[380px] max-h-[70vh] overflow-y-auto styled-scrollbar rounded-lg border border-[var(--border-primary)] shadow-[0_18px_48px_rgba(0,0,0,0.7)] z-50"
              style={{ background: 'var(--bg-panel-solid)' }}>
              <EngineSheet engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey} onDone={() => setEngineOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
    const askView = (
      <>
        {askForm}
        {oi.history.length > 0 && <div className="border-t border-[var(--border-secondary)]"><HistoryList oi={oi} onPick={id => { setTab(null); onSelect(null); void oi.watch(id); }} /></div>}
      </>
    );
    const node = (
      <Workspace s={s} oi={oi} selected={selected} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent}
        onTheater={props.onTheater} focus={props.focus} onFocus={props.onFocus} following={props.following} onFollow={props.onFollow}
        mode={props.mode} onMode={props.onMode} stage={props.stage} onStage={props.onStage}
        lists={tabs} errorBox={errorBox} assistView={assistView} askView={askView} engineMenu={engineMenu}
        onNewForecast={reset} assistBusy={props.assist.busy} />
    );
    return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
  }

  /* ── Docked, or in the phone drawer ── */
  const assisting = props.mode === 'assist';
  const header = (
    <header className={`flex items-center gap-2 ${embedded ? 'pb-3' : 'px-4 py-3 border-b border-[var(--border-secondary)]'}`}>
      {embedded ? <span className={`${LABEL} text-[var(--text-muted)] truncate`}>{assisting ? 'Ask anything' : 'Swarm forecasting'}</span> : (
        <>
          <OiMark live={s?.status === 'running' || props.assist.busy} />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">OI</span>
          {!s && !assisting && <span className={`${LABEL} text-[var(--text-muted)] truncate`}>Swarm forecasting</span>}
          {assisting && <span className={`${LABEL} text-[var(--text-muted)] truncate`}>Ask anything</span>}
          {s?.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[var(--alert-green)] animate-osiris-pulse" title="Forecast running" />}
        </>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <EnginePill engine={engine} ready={ready} open={engineOpen} onClick={() => setEngineOpen(v => !v)} />
        {!assisting && <IconButton title={showHistory ? 'Back' : 'Your forecasts'} onClick={() => setShowHistory(v => !v)} active={showHistory}><History className="w-3.5 h-3.5" /></IconButton>}
        {!assisting && s && <IconButton title="New forecast" onClick={reset}><Plus className="w-3.5 h-3.5" /></IconButton>}
        {!embedded && props.onTheater && <IconButton title="Full screen: the OI workspace" onClick={() => props.onTheater?.(true)}><Maximize2 className="w-3.5 h-3.5" /></IconButton>}
        {props.onClose && !embedded && <IconButton title="Close (the run keeps going)" onClick={props.onClose}><X className="w-3.5 h-3.5" /></IconButton>}
      </div>
    </header>
  );

  const modeSwitch = (
    <div className={embedded ? 'pb-3' : 'px-3 py-2 border-b border-[var(--border-secondary)]'}>
      <Segmented id={embedded ? 'oi-mode-m' : 'oi-mode'} size="sm" value={props.mode} onChange={props.onMode} options={[
        { value: 'forecast', label: s?.status === 'running' ? 'Forecast ●' : 'Forecast', icon: <Orbit className="w-3 h-3" />, title: 'The forecasting swarm' },
        { value: 'assist', label: 'Assist', icon: <MessageSquare className="w-3 h-3" />, title: 'Talk to OI: it works the map for you' },
      ]} />
    </div>
  );

  const body = assisting ? (
    <>
      <AnimatePresence initial={false}>
        {engineOpen && (
          <motion.div key="engine" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <EngineSheet engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey} onDone={() => setEngineOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {assistView}
    </>
  ) : (
    <>
      <AnimatePresence initial={false}>
        {engineOpen && (
          <motion.div key="engine" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <EngineSheet engine={engine} setEngine={setEngine} keyValue={key} setKey={setKey} onDone={() => setEngineOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {errorBox}
      {showHistory ? (
        <HistoryList oi={oi} onPick={id => { setShowHistory(false); setTab(null); onSelect(null); void oi.watch(id); }} />
      ) : !s ? (
        askForm
      ) : (
        <div className="flex flex-col">
          <div className="px-4 pt-4 pb-5 flex flex-col gap-5 border-b border-[var(--border-secondary)]">
            <RunHead s={s} oi={oi} focus={props.focus} onFocus={props.onFocus} following={props.following} onFollow={props.onFollow} />
            <Verdict key={oi.runId ?? ''} s={s} />
          </div>
          <AnimatePresence mode="wait">
            {selection && (
              <motion.div key={selection.key} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="px-4 pt-4">
                <ObjectView s={s} sel={selection} onSelect={onSelect} onLocate={props.onLocate} onAsk={askAgent} />
              </motion.div>
            )}
          </AnimatePresence>
          {s.status === 'running' && oi.canSteer && <div className="px-4 pt-4"><InjectBox oi={oi} s={s} /></div>}
          <div className="pt-2">{tabs}</div>
          <UsageLine s={s} />
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex flex-col">{header}{modeSwitch}<div className="-mx-3">{body}</div></div>;

  return (
    <div className="glass-panel overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      {header}
      {modeSwitch}
      <div className="min-h-0 overflow-y-auto styled-scrollbar">{body}</div>
    </div>
  );
}
