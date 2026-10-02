'use client';
/**
 * OSIRIS OSI: the research graph.
 *
 * The full-screen alternative to the globe, after MiroFish's knowledge graph:
 * every actor, panelist and cited piece of evidence as a node, every relation,
 * exchange, weighing and citation as an edge, all of it on screen at once.
 * Edges take the same three colours as the arcs on the globe (Style Studio →
 * OSI), nodes take the theme's own accents, and a click opens the same
 * research the globe does.
 *
 * The layout is a small force simulation (lib/osi/graph). React draws the
 * elements; positions are written straight onto them each frame, so a tick
 * never re-renders the tree. The camera fits the graph as it grows until
 * someone pans or zooms, like the globe's camera follows the run.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { buildGraph, createLayout, edgePath, fitView, litSet, type GraphEdge, type GraphNode, type View } from '@/lib/osi/graph';
import { brief } from '@/lib/osi/research';
import type { RunState } from '@/lib/osi/state';
import type { Tone } from '@/lib/osi/types';

const TONE: Record<Tone, string> = {
  support: 'var(--map-osi-support, #b388ff)',
  oppose: 'var(--map-osi-oppose, #ff5ccb)',
  neutral: 'var(--map-osi-neutral, #8c7cff)',
};
const BASE_OPACITY: Record<GraphEdge['kind'], number> = { relation: 0.85, reply: 0.7, focus: 0.42, evidence: 0.5 };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function OsiGraph({ s, selected, onSelect, bottomInset = 0 }: {
  s: RunState; selected: string | null; onSelect: (key: string | null) => void;
  /** Height at the bottom covered by something else (the inspector): the camera frames the space above it. */
  bottomInset?: number;
}) {
  const graph = useMemo(() => buildGraph(s), [s]);
  const [layout] = useState(createLayout);
  const [hover, setHover] = useState<string | null>(null);
  const [labels, setLabels] = useState(false);
  const [following, setFollowing] = useState(true);

  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGPathElement>());
  const hitEls = useRef(new Map<string, SVGPathElement>());
  const labelEls = useRef(new Map<string, SVGTextElement>());
  const current = useRef(graph);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const follow = useRef(true);
  /** What the camera frames: the selection and its neighbours, or (null) the whole graph. */
  const framed = useRef<Set<string> | null>(null);
  const inset = useRef(bottomInset);
  const size = useRef({ w: 0, h: 0 });
  const frame = useRef(0);
  const drag = useRef<{ key: string | null; x0: number; y0: number; vx: number; vy: number; moved: boolean } | null>(null);

  /** Writes every position onto its element. */
  const paint = useCallback(() => {
    const v = view.current;
    world.current?.setAttribute('transform', `translate(${v.x.toFixed(1)},${v.y.toFixed(1)}) scale(${v.k.toFixed(4)})`);
    // Labels hold their size on screen as the graph zooms out, within reason.
    svg.current?.style.setProperty('--ls', String(Math.min(1.9, Math.max(0.85, 1 / v.k))));
    for (const [key, el] of nodeEls.current) {
      const b = layout.bodies.get(key);
      if (b) el.setAttribute('transform', `translate(${b.x.toFixed(1)},${b.y.toFixed(1)})`);
    }
    for (const e of current.current.edges) {
      const a = layout.bodies.get(e.from), b = layout.bodies.get(e.to);
      if (!a || !b) continue;
      const p = edgePath(a, b, e.curve);
      edgeEls.current.get(e.key)?.setAttribute('d', p.d);
      hitEls.current.get(e.key)?.setAttribute('d', p.d);
      const t = labelEls.current.get(e.key);
      if (t) { t.setAttribute('x', p.mx.toFixed(1)); t.setAttribute('y', p.my.toFixed(1)); }
    }
  }, [layout]);

  /** Runs the simulation and the camera until both are still. */
  const kick = useCallback(() => {
    if (frame.current) return;
    const tick = () => {
      const moving = layout.step(current.current);
      let easing = false;
      if (follow.current && size.current.w > 0 && layout.bodies.size) {
        const keys = framed.current;
        const bodies = keys ? [...keys].map(k => layout.bodies.get(k)!).filter(Boolean) : [...layout.bodies.values()];
        const target = fitView(bodies.length ? bodies : layout.bodies.values(), size.current.w, Math.max(160, size.current.h - inset.current), keys ? 90 : 64);
        const v = view.current;
        const t = 0.14;
        const next = { x: v.x + (target.x - v.x) * t, y: v.y + (target.y - v.y) * t, k: v.k + (target.k - v.k) * t };
        easing = Math.abs(next.x - v.x) + Math.abs(next.y - v.y) + Math.abs(next.k - v.k) * 200 > 0.15;
        view.current = next;
      }
      paint();
      frame.current = moving || easing || drag.current?.key ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  }, [layout, paint]);

  // A new graph: seed what is new and place everything before the browser paints, so nothing flashes at the origin.
  useLayoutEffect(() => {
    current.current = graph;
    layout.sync(graph);
    paint();
    kick();
  }, [graph, layout, paint, kick]);

  // Forget the frame as well as cancelling it, or the next kick would think the loop is still running.
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      kick();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [kick]);

  const stopFollowing = useCallback(() => { follow.current = false; setFollowing(false); }, []);
  const refit = () => { framed.current = null; inset.current = 0; follow.current = true; setFollowing(true); kick(); };

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const v = view.current;
    const k = Math.min(4, Math.max(0.2, v.k * factor));
    view.current = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    stopFollowing();
    paint();
  }, [paint, stopFollowing]);

  // Wheel zoom needs a listener that may cancel the page's own scroll.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const toWorld = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const onPointerDown = (e: React.PointerEvent, key: string | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { key, x0: e.clientX, y0: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const t = tip.current, r = box.current?.getBoundingClientRect();
    if (t && r) {
      const x = e.clientX - r.left, y = e.clientY - r.top;
      t.style.left = `${Math.min(x + 14, r.width - 280)}px`;
      t.style.top = `${Math.min(y + 16, r.height - 70)}px`;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    if (d.key) {
      const body = layout.bodies.get(d.key);
      if (!body) return;
      const p = toWorld(e.clientX, e.clientY);
      body.fx = p.x; body.fy = p.y;
      layout.heat(0.25);
      kick();
    } else {
      view.current = { ...view.current, x: d.vx + e.clientX - d.x0, y: d.vy + e.clientY - d.y0 };
      stopFollowing();
      paint();
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.key) {
      const body = layout.bodies.get(d.key);
      if (body) { body.fx = null; body.fy = null; }
      if (!d.moved) onSelect(d.key === selected ? null : d.key);
    } else if (!d.moved) onSelect(null);
  };

  // A selection, from here, the globe or a list, brings the camera round to it and its neighbours, above whatever covers the bottom.
  // Keyed on which nodes are framed, not on the graph object, so a live run's updates do not take the camera back.
  const framedKey = useMemo(() => {
    const lit = litSet(graph, selected);
    return lit ? JSON.stringify([...lit.nodes].sort()) : '';
  }, [graph, selected]);
  const [framedFor, setFramedFor] = useState(framedKey);
  if (framedFor !== framedKey) { setFramedFor(framedKey); setFollowing(true); }
  useEffect(() => {
    framed.current = framedKey ? new Set(JSON.parse(framedKey) as string[]) : null;
    inset.current = framedKey ? bottomInset : 0;
    follow.current = true;
    kick();
  }, [framedKey, bottomInset, kick]);

  const active = hover ?? selected;
  const lit = useMemo(() => litSet(graph, active), [graph, active]);
  const hoverBrief = hover ? brief(s, hover) : null;
  const counts = { actors: graph.nodes.filter(n => n.kind === 'actor').length, agents: graph.nodes.filter(n => n.kind === 'agent').length };

  const nodeRef = (key: string) => (el: SVGGElement | null) => {
    if (el) nodeEls.current.set(key, el); else nodeEls.current.delete(key);
  };
  const edgeRef = (key: string) => (el: SVGPathElement | null) => {
    if (el) edgeEls.current.set(key, el); else edgeEls.current.delete(key);
  };
  const hitRef = (key: string) => (el: SVGPathElement | null) => {
    if (el) hitEls.current.set(key, el); else hitEls.current.delete(key);
  };

  return (
    <div ref={box} className="relative w-full h-full overflow-hidden select-none"
      style={{
        backgroundColor: 'rgba(4,4,10,0.55)',
        backgroundImage: 'radial-gradient(rgba(var(--gold-rgb),0.10) 1px, transparent 1.2px)',
        backgroundSize: '22px 22px',
      }}>
      <svg ref={svg} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={e => onPointerDown(e, null)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <g ref={world}>
          {/* Edges first, under the nodes; each has a wide invisible twin that takes the clicks. */}
          <g>
            {graph.edges.map(e => {
              const on = lit?.edges.has(e.key);
              const opacity = lit ? (on ? 1 : 0.06) : BASE_OPACITY[e.kind];
              return (
                <path key={e.key} ref={edgeRef(e.key)} fill="none" vectorEffect="non-scaling-stroke"
                  className={`osi-graph-in ${e.kind === 'focus' ? 'osi-graph-march' : ''}`}
                  style={{
                    stroke: e.kind === 'evidence' ? `color-mix(in srgb, ${TONE[e.tone]} 60%, #ddd8f0)` : TONE[e.tone],
                    strokeWidth: (e.kind === 'relation' ? 1 + e.strength * 1.6 : e.kind === 'reply' ? 0.9 + e.strength : 1) + (on ? 0.8 : 0),
                    strokeDasharray: e.kind === 'focus' ? '4 4' : undefined,
                    opacity,
                    transition: 'opacity .25s ease',
                  }} />
              );
            })}
          </g>
          <g>
            {graph.edges.map(e => (
              <path key={e.key} ref={hitRef(e.key)} data-osi-edge={e.key} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke"
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onPointerDown={ev => ev.stopPropagation()}
                onClick={() => onSelect(e.key === selected ? null : e.key)}
                onPointerEnter={() => setHover(e.key)} onPointerLeave={() => setHover(h => (h === e.key ? null : h))} />
            ))}
          </g>
          {/* Edge labels: the edge under the pointer; with LABELS on, every edge in view (or in the focus);
              otherwise the relations and exchanges of whatever is hovered, so a selection stays readable. */}
          <g style={{ pointerEvents: 'none' }}>
            {graph.edges.map(e => {
              const isLit = Boolean(lit?.edges.has(e.key));
              const show = e.label && (active === e.key || (labels
                ? (!lit || isLit) && e.kind !== 'focus'
                : Boolean(hover) && isLit && (e.kind === 'relation' || e.kind === 'reply')));
              if (!show) return null;
              return (
                <text key={e.key} ref={el => {
                  if (!el) { labelEls.current.delete(e.key); return; }
                  labelEls.current.set(e.key, el);
                  // A label can appear without the graph moving (on hover): place it straight away.
                  const a = layout.bodies.get(e.from), b = layout.bodies.get(e.to);
                  if (a && b) { const p = edgePath(a, b, e.curve); el.setAttribute('x', p.mx.toFixed(1)); el.setAttribute('y', p.my.toFixed(1)); }
                }}
                  textAnchor="middle" dy="0.35em" className="font-mono"
                  style={{ fontSize: 'calc(9px * var(--ls, 1))', fill: 'var(--text-secondary)', stroke: 'rgba(4,4,10,0.92)', strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round' }}>
                  {clip(e.label, 30)}
                </text>
              );
            })}
          </g>
          <g>
            {graph.nodes.map(n => (
              <GraphDot key={n.key} n={n} refFn={nodeRef(n.key)} selected={selected === n.key} dim={Boolean(lit && !lit.nodes.has(n.key))}
                showLabel={n.kind !== 'evidence' || labels || Boolean(lit?.nodes.has(n.key))} thinking={n.kind === 'agent' && n.key.slice(2) in s.thinking}
                onDown={e => onPointerDown(e, n.key)} onEnter={() => setHover(n.key)} onLeave={() => setHover(h => (h === n.key ? null : h))} />
            ))}
          </g>
        </g>
      </svg>

      {/* The graph's own HUD: what it is, and the ways to look at it. */}
      <div className="absolute left-4 top-3.5 pointer-events-none">
        <div className="hud-text text-[10px] text-[var(--gold-primary)]">Research graph</div>
        <div className="mt-0.5 text-[9px] font-mono tracking-[0.14em] text-[var(--text-muted)]">
          {counts.actors} ACTORS · {counts.agents} PANELISTS · {graph.edges.length} LINKS
        </div>
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-[3px] p-[3px] rounded-lg border border-[var(--border-secondary)] bg-black/50 backdrop-blur-md">
        <button onClick={() => setLabels(v => !v)} aria-pressed={labels} title="Show every link's label"
          className={`h-7 px-2.5 rounded-md text-[9px] font-mono tracking-[0.16em] transition-colors ${labels ? 'text-[var(--gold-light)] bg-[var(--gold-primary)]/10 border border-[var(--border-active)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-accent)] border border-transparent'}`}>
          LABELS
        </button>
        <span className="w-px h-4 mx-0.5 bg-[var(--border-secondary)]" />
        <GraphButton title="Zoom out" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.3)}><Minus className="w-3.5 h-3.5" /></GraphButton>
        <GraphButton title="Zoom in" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.3)}><Plus className="w-3.5 h-3.5" /></GraphButton>
        <GraphButton title="Fit the whole graph and follow it as it grows" onClick={refit} active={following}><Maximize className="w-3.5 h-3.5" /></GraphButton>
      </div>

      <GraphLegend />

      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] font-mono tracking-[0.2em] text-[var(--text-muted)]">
            {s.status === 'running' ? 'THE GRAPH BUILDS AS THE WORLD IS MAPPED…' : 'NOTHING TO GRAPH IN THIS RUN'}
          </span>
        </div>
      )}

      <div ref={tip} className="absolute pointer-events-none max-w-[270px] rounded-lg border border-[var(--border-primary)] px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        style={{ background: 'rgba(12,14,26,0.94)', opacity: hoverBrief ? 1 : 0, transition: 'opacity .15s ease' }}>
        {hoverBrief && (
          <>
            <div className="text-[11.5px] font-medium leading-snug text-[var(--text-heading)]">{hoverBrief.title}</div>
            {hoverBrief.detail && <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-secondary)]">{hoverBrief.detail}</div>}
            <div className="mt-1 text-[8.5px] font-mono tracking-[0.18em] text-[var(--gold-primary)]">CLICK TO OPEN</div>
          </>
        )}
      </div>
    </div>
  );
}

function GraphButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--hover-accent)] ${active ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

const NODE_STYLE: Record<GraphNode['kind'], { fill: string; stroke: string; core?: string }> = {
  actor: { fill: 'rgba(var(--gold-rgb),0.16)', stroke: 'var(--gold-primary)', core: 'var(--gold-light)' },
  agent: { fill: 'rgba(var(--cyan-rgb),0.13)', stroke: 'var(--cyan-primary)' },
  evidence: { fill: 'var(--text-secondary)', stroke: 'transparent' },
};

function GraphDot({ n, refFn, selected, dim, showLabel, thinking, onDown, onEnter, onLeave }: {
  n: GraphNode; refFn: (el: SVGGElement | null) => void; selected: boolean; dim: boolean; showLabel: boolean; thinking: boolean;
  onDown: (e: React.PointerEvent) => void; onEnter: () => void; onLeave: () => void;
}) {
  const st = NODE_STYLE[n.kind];
  const label = n.kind === 'evidence' ? clip(n.label, 36) : n.label;
  return (
    <g ref={refFn} data-osi-node={n.key} style={{ cursor: 'pointer', opacity: dim ? 0.16 : 1, transition: 'opacity .25s ease' }}
      onPointerDown={onDown} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <g className="osi-graph-in">
        {thinking && <circle r={n.radius + 6} className="osi-graph-ping" style={{ fill: 'none', stroke: 'var(--cyan-primary)', strokeWidth: 1.2 }} vectorEffect="non-scaling-stroke" />}
        {selected && <circle r={n.radius + 5} style={{ fill: 'none', stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 6px rgba(var(--gold-rgb),0.8))' }} vectorEffect="non-scaling-stroke" />}
        <circle r={n.radius} style={{ fill: st.fill, stroke: st.stroke, strokeWidth: 1.5, opacity: n.kind === 'evidence' ? 0.85 : 1 }} vectorEffect="non-scaling-stroke" />
        {st.core && <circle r={2.6} style={{ fill: st.core }} />}
        {showLabel && (
          <text y={n.radius} dy="1.25em" textAnchor="middle" className={n.kind === 'evidence' ? 'font-mono' : ''}
            style={{
              fontSize: `calc(${n.kind === 'actor' ? 10.5 : n.kind === 'agent' ? 10 : 9}px * var(--ls, 1))`,
              fontWeight: n.kind === 'actor' ? 600 : 500,
              fill: n.kind === 'actor' ? 'var(--text-heading)' : n.kind === 'agent' ? 'var(--text-primary)' : 'var(--text-secondary)',
              stroke: 'rgba(4,4,10,0.92)', strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round', pointerEvents: 'none',
            }}>
            {label}
          </text>
        )}
      </g>
    </g>
  );
}

/** What the marks mean: the nodes by kind, the edges in the globe's own line colours. */
function GraphLegend() {
  const node = (label: string, style: React.CSSProperties) => (
    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={style} />{label}</span>
  );
  const line = (label: string, color: string, dash?: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden><line x1="1" x2="17" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" /></svg>{label}
    </span>
  );
  return (
    <div className="absolute left-3 bottom-3 flex flex-col gap-1.5 rounded-lg border border-[var(--border-secondary)] bg-black/50 backdrop-blur-md px-3 py-2 text-[9px] font-mono tracking-[0.12em] text-[var(--text-secondary)] pointer-events-none">
      <div className="flex items-center gap-3">
        {node('ACTOR', { background: 'rgba(var(--gold-rgb),0.2)', boxShadow: 'inset 0 0 0 1.5px var(--gold-primary)' })}
        {node('PANELIST', { background: 'rgba(var(--cyan-rgb),0.15)', boxShadow: 'inset 0 0 0 1.5px var(--cyan-primary)' })}
        {node('EVIDENCE', { background: 'var(--text-secondary)', transform: 'scale(0.7)' })}
      </div>
      <div className="flex items-center gap-3">
        {line('ALIGNED', TONE.support)}
        {line('OPPOSED', TONE.oppose)}
        {line('BETWEEN', TONE.neutral)}
        {line('WEIGHING', TONE.neutral, '3 3')}
      </div>
    </div>
  );
}
