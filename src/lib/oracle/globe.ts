/**
 * OSIRIS Oracle on the globe.
 *
 * While a run thinks, its analysis draws itself on the map: the actors land
 * where they act, relations between them rise as purple arcs through the sky,
 * evidence from the live feed strikes in, the panel appears city by city, and
 * every reply and every "I'm weighing this actor" during the debate fires a
 * new arc, pulsing from speaker to target. Panelists mid-thought ripple.
 *
 * The arcs are a WebGL custom layer: ribbons of constant pixel width, lifted
 * along great circles through MapLibre's own projectTileFor3D (so they curve
 * with the globe, flatten with the 2D map, and the far side hides them), with
 * a reveal, a travelling pulse and a glow done in the shader. Nodes and labels
 * are ordinary GeoJSON layers.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, FilterSpecification, GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { ARC_STRIDE, mercator, packArcs, rgb, type ArcSpec, type LngLat } from './arcs';
import { latestPosts, type RunState } from './state';
import type { Link } from './types';

export const ORACLE_ARCS = 'oracle-arcs';
const NODES = 'oracle-nodes';
const LAYERS = ['oracle-node-halo', 'oracle-node-core', 'oracle-label-actor', 'oracle-label-agent', 'oracle-label-forecast'] as const;

export const ORACLE_COLORS = {
  support: '#B388FF',
  oppose: '#FF5CCB',
  neutral: '#8C7CFF',
  evidence: '#A99BE0',
  actor: '#C9A6FF',
  context: '#9A93B8',
  yes: '#FF5CCB',
  no: '#6E8BFF',
};

const KIND: Record<Link['kind'], number> = { relation: 0, evidence: 1, reply: 2, focus: 3 };

/** An agent's colour: cool indigo toward NO, hot magenta toward YES, purple between. */
export function leanColor(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return '#B388FF';
  const stops: [number, [number, number, number]][] = [[0, [0x6e, 0x8b, 0xff]], [0.5, [0xb3, 0x88, 0xff]], [1, [0xff, 0x5c, 0xcb]]];
  const i = p <= 0.5 ? 0 : 1;
  const [p0, c0] = stops[i];
  const [p1, c1] = stops[i + 1];
  const t = Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
  const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/* ───────────────────────────── Shaders ───────────────────────────── */

const ARC_VERT = `
in vec3 a_pos;
in vec3 a_prev;
in vec3 a_next;
in vec2 a_meta;   // side, t along the arc
in vec3 a_color;
in vec3 a_info;   // strength, birth, kind
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_lift;
uniform float u_now;
out float v_side;
out float v_t;
out vec3 v_color;
out float v_strength;
out float v_age;
out float v_kind;
vec2 screen(vec4 c) { return c.xy / c.w * u_viewport * 0.5; }
void main() {
  vec4 cur = projectTileFor3D(a_pos.xy, a_pos.z * u_lift);
  vec4 prv = projectTileFor3D(a_prev.xy, a_prev.z * u_lift);
  vec4 nxt = projectTileFor3D(a_next.xy, a_next.z * u_lift);
  vec2 d = screen(nxt) - screen(prv);
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float kind = a_info.z;
  // Band width in pixels: wide enough for a soft glow either side of the line.
  float width = (kind > 2.5 ? 6.0 : kind > 1.5 ? 9.0 : kind > 0.5 ? 6.0 : 8.0 + 6.0 * a_info.x) * u_ratio;
  // Multiplying by w cancels the perspective divide: constant width on screen.
  cur.xy += normal * a_meta.x * width / u_viewport * cur.w;
  gl_Position = cur;
  v_side = a_meta.x;
  v_t = a_meta.y;
  v_color = a_color;
  v_strength = a_info.x;
  v_age = u_now - a_info.y;
  v_kind = kind;
}`;

const ARC_FRAG = `
precision highp float;
in float v_side;
in float v_t;
in vec3 v_color;
in float v_strength;
in float v_age;
in float v_kind;
uniform float u_now;
uniform float u_motion; // 0 when the viewer asked for reduced motion
uniform float u_flow;   // 1 while the run is live: pulses travel, dashes march
out vec4 fragColor;
void main() {
  if (v_age < 0.0) discard;
  // The arc draws itself from speaker to target.
  float reveal = u_motion > 0.5 ? clamp(v_age / 1.1, 0.0, 1.0) : 1.0;
  reveal = 1.0 - pow(1.0 - reveal, 3.0);
  if (v_t > reveal) discard;

  float d = abs(v_side);
  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d * 3.0) * 0.32;
  float head = reveal < 1.0 ? smoothstep(0.1, 0.0, reveal - v_t) * 1.4 : 0.0;

  float speed = v_kind > 1.5 ? 0.5 : 0.22;
  float phase = fract(v_t - u_now * speed + v_strength * 3.7);
  float pulse = u_flow * u_motion * smoothstep(0.9, 1.0, phase) * 1.3;

  float shape = core + halo;
  if (v_kind > 2.5) {
    // "Weighing this actor": marching dashes.
    float dash = step(0.5, fract(v_t * 24.0 - u_now * 0.9 * u_flow * u_motion));
    shape *= mix(0.2, 1.0, dash);
  }
  float base = v_kind > 0.5 && v_kind < 1.5 ? 0.5 : 0.9;
  float flash = 1.0 + 1.3 * exp(-v_age * 1.4) * u_motion;
  // Interactions from earlier rounds settle back, never out.
  float settle = v_kind > 1.5 ? mix(1.0, 0.4, clamp((v_age - 30.0) / 40.0, 0.0, 1.0)) : 1.0;
  float ends = mix(0.35, 1.0, smoothstep(0.0, 0.05, v_t) * smoothstep(1.0, 0.95, v_t));

  float alpha = clamp((shape * base * (0.55 + 0.45 * v_strength) + head + pulse * core) * flash * settle * ends, 0.0, 1.0);
  vec3 col = mix(v_color, vec3(1.0), clamp(core * 0.3 + head * 0.5 + pulse * 0.6, 0.0, 1.0));
  fragColor = vec4(col * alpha, alpha);
}`;

const PING_VERT = `
in vec2 a_corner;
in vec2 a_pos;
in vec4 a_ping;   // rgb, size in px
in vec3 a_time;   // start, period, once
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_now;
uniform float u_motion;
out vec2 v_corner;
out vec3 v_color;
out float v_phase;
out float v_alive;
void main() {
  vec4 c = projectTileFor3D(a_pos, 0.0);
  float px = a_ping.w * u_ratio;
  gl_Position = c + vec4(a_corner * px / u_viewport * 2.0 * c.w, 0.0, 0.0);
  float age = u_now - a_time.x;
  float ph = age / a_time.y;
  v_alive = (age < 0.0 || (a_time.z > 0.5 && ph > 1.0) || u_motion < 0.5) ? 0.0 : 1.0;
  v_phase = fract(ph);
  v_corner = a_corner;
  v_color = a_ping.rgb;
}`;

const PING_FRAG = `
precision mediump float;
in vec2 v_corner;
in vec3 v_color;
in float v_phase;
in float v_alive;
out vec4 fragColor;
void main() {
  if (v_alive < 0.5) discard;
  float r = length(v_corner);
  float ring = smoothstep(0.14, 0.0, abs(r - v_phase)) * (1.0 - v_phase);
  float a = ring * 0.85;
  if (a < 0.01) discard;
  fragColor = vec4(v_color * a, a);
}`;

/* ───────────────────────────── The arc layer ───────────────────────────── */

interface Ping { pos: [number, number]; color: [number, number, number]; size: number; start: number; period: number; once: boolean }

const clock = () => performance.now() / 1000;

function createArcLayer(): CustomLayerInterface & {
  setArcs(arcs: ArcSpec[]): void;
  setPings(pings: Ping[]): void;
  setLive(live: boolean): void;
} {
  let gl: WebGL2RenderingContext | null = null;
  let map: MlMap | null = null;
  const programs = new Map<string, { arc: WebGLProgram; ping: WebGLProgram }>();
  let arcs: ArcSpec[] = [];
  let pings: Ping[] = [];
  let arcBuf: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number } | null = null;
  let pingBuf: { vao: WebGLVertexArrayObject; quad: WebGLBuffer; inst: WebGLBuffer; count: number } | null = null;
  let arcsDirty = false;
  let pingsDirty = false;
  /** The programs the buffers were bound for: a projection change brings new ones, with their own attribute slots. */
  let boundTo: { arc: WebGLProgram; ping: WebGLProgram } | null = null;
  let live = false;
  let lastBirth = 0;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const compile = (type: number, src: string) => {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      const log = gl!.getShaderInfoLog(s);
      gl!.deleteShader(s);
      throw new Error(`oracle layer shader failed: ${log}`);
    }
    return s;
  };
  const link = (prelude: string, define: string, vert: string, frag: string) => {
    const p = gl!.createProgram()!;
    const vs = compile(gl!.VERTEX_SHADER, `#version 300 es\n${prelude}\n${define}\n${vert}`);
    const fs = compile(gl!.FRAGMENT_SHADER, `#version 300 es\n${frag}`);
    gl!.attachShader(p, vs);
    gl!.attachShader(p, fs);
    gl!.linkProgram(p);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
      const log = gl!.getProgramInfoLog(p);
      gl!.deleteProgram(p);
      throw new Error(`oracle layer link failed: ${log}`);
    }
    return p;
  };
  /** One pair of programs per projection variant: the prelude changes with the projection. */
  const programsFor = (shader: CustomRenderMethodInput['shaderData']) => {
    const key = `${shader.variantName}\0${shader.define}`;
    let pair = programs.get(key);
    if (!pair) {
      pair = {
        arc: link(shader.vertexShaderPrelude, shader.define, ARC_VERT, ARC_FRAG),
        ping: link(shader.vertexShaderPrelude, shader.define, PING_VERT, PING_FRAG),
      };
      programs.set(key, pair);
    }
    return pair;
  };

  const attrib = (program: WebGLProgram, name: string, size: number, stride: number, offset: number, divisor = 0) => {
    const loc = gl!.getAttribLocation(program, name);
    if (loc < 0) return;
    gl!.enableVertexAttribArray(loc);
    gl!.vertexAttribPointer(loc, size, gl!.FLOAT, false, stride, offset);
    gl!.vertexAttribDivisor(loc, divisor);
  };

  const buildArcs = (program: WebGLProgram) => {
    const g = gl!;
    if (arcBuf) { g.deleteVertexArray(arcBuf.vao); g.deleteBuffer(arcBuf.vbo); g.deleteBuffer(arcBuf.ibo); arcBuf = null; }
    if (!arcs.length) return;
    const { vertices, indices } = packArcs(arcs);
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const vbo = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    g.bufferData(g.ARRAY_BUFFER, vertices, g.STATIC_DRAW);
    const S = ARC_STRIDE * 4;
    attrib(program, 'a_pos', 3, S, 0);
    attrib(program, 'a_prev', 3, S, 12);
    attrib(program, 'a_next', 3, S, 24);
    attrib(program, 'a_meta', 2, S, 36);
    attrib(program, 'a_color', 3, S, 44);
    attrib(program, 'a_info', 3, S, 56);
    const ibo = g.createBuffer()!;
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, indices, g.STATIC_DRAW);
    g.bindVertexArray(null);
    arcBuf = { vao, vbo, ibo, count: indices.length };
  };

  const buildPings = (program: WebGLProgram) => {
    const g = gl!;
    if (pingBuf) { g.deleteVertexArray(pingBuf.vao); g.deleteBuffer(pingBuf.quad); g.deleteBuffer(pingBuf.inst); pingBuf = null; }
    if (!pings.length) return;
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const quad = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), g.STATIC_DRAW);
    attrib(program, 'a_corner', 2, 8, 0);
    const data = new Float32Array(pings.length * 9);
    pings.forEach((p, i) => data.set([p.pos[0], p.pos[1], ...p.color, p.size, p.start, p.period, p.once ? 1 : 0], i * 9));
    const inst = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, inst);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    attrib(program, 'a_pos', 2, 36, 0, 1);
    attrib(program, 'a_ping', 4, 36, 8, 1);
    attrib(program, 'a_time', 3, 36, 24, 1);
    g.bindVertexArray(null);
    pingBuf = { vao, quad, inst, count: pings.length };
  };

  const setProjection = (program: WebGLProgram, proj: NonNullable<CustomRenderMethodInput['defaultProjectionData']>) => {
    const u = (n: string) => gl!.getUniformLocation(program, n);
    gl!.uniformMatrix4fv(u('u_projection_matrix'), false, proj.mainMatrix as Float32List);
    gl!.uniform4fv(u('u_projection_tile_mercator_coords'), proj.tileMercatorCoords as Float32List);
    gl!.uniform4fv(u('u_projection_clipping_plane'), proj.clippingPlane as Float32List);
    gl!.uniform1f(u('u_projection_transition'), proj.projectionTransition);
    gl!.uniformMatrix4fv(u('u_projection_fallback_matrix'), false, proj.fallbackMatrix as Float32List);
  };

  return {
    id: ORACLE_ARCS,
    type: 'custom',
    renderingMode: '3d',

    setArcs(next) {
      arcs = next;
      arcsDirty = true;
      lastBirth = Math.max(0, ...next.map(a => a.birth));
      map?.triggerRepaint();
    },
    setPings(next) {
      pings = next;
      pingsDirty = true;
      map?.triggerRepaint();
    },
    setLive(v) {
      live = v;
      map?.triggerRepaint();
    },

    onAdd(m, context) {
      map = m;
      gl = context as WebGL2RenderingContext;
      arcsDirty = pingsDirty = true;
    },

    onRemove() {
      if (gl) {
        if (arcBuf) { gl.deleteVertexArray(arcBuf.vao); gl.deleteBuffer(arcBuf.vbo); gl.deleteBuffer(arcBuf.ibo); }
        if (pingBuf) { gl.deleteVertexArray(pingBuf.vao); gl.deleteBuffer(pingBuf.quad); gl.deleteBuffer(pingBuf.inst); }
        for (const p of programs.values()) { gl.deleteProgram(p.arc); gl.deleteProgram(p.ping); }
      }
      programs.clear();
      boundTo = null;
      arcBuf = pingBuf = null;
      gl = null;
      map = null;
    },

    render(_ctx, args) {
      if (!gl || !map) return;
      const proj = args.defaultProjectionData;
      if (!proj || !args.shaderData?.vertexShaderPrelude) return;
      let pair: { arc: WebGLProgram; ping: WebGLProgram };
      try { pair = programsFor(args.shaderData); }
      catch (err) { console.error('[OSIRIS] oracle layer:', err instanceof Error ? err.message : err); return; }
      if (boundTo !== pair) { arcsDirty = pingsDirty = true; boundTo = pair; }
      if (arcsDirty) { buildArcs(pair.arc); arcsDirty = false; }
      if (pingsDirty) { buildPings(pair.ping); pingsDirty = false; }
      if (!arcBuf && !pingBuf) return;

      const now = clock();
      const zoom = map.getZoom();
      // Arcs a thousand kilometres high mean nothing over a city: they settle as the view closes in.
      const lift = zoom <= 3.5 ? 1 : Math.max(0.12, 1 - (zoom - 3.5) * 0.22);
      const motion = reduced ? 0 : 1;
      const viewport = [gl.drawingBufferWidth, gl.drawingBufferHeight] as const;
      const ratio = window.devicePixelRatio || 1;

      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      if (arcBuf) {
        const p = pair.arc;
        gl.useProgram(p);
        setProjection(p, proj);
        const u = (n: string) => gl!.getUniformLocation(p, n);
        gl.uniform2f(u('u_viewport'), viewport[0], viewport[1]);
        gl.uniform1f(u('u_ratio'), ratio);
        gl.uniform1f(u('u_lift'), lift);
        gl.uniform1f(u('u_now'), now);
        gl.uniform1f(u('u_motion'), motion);
        gl.uniform1f(u('u_flow'), live ? 1 : 0);
        gl.bindVertexArray(arcBuf.vao);
        gl.drawElements(gl.TRIANGLES, arcBuf.count, gl.UNSIGNED_INT, 0);
      }
      if (pingBuf) {
        const p = pair.ping;
        gl.useProgram(p);
        setProjection(p, proj);
        const u = (n: string) => gl!.getUniformLocation(p, n);
        gl.uniform2f(u('u_viewport'), viewport[0], viewport[1]);
        gl.uniform1f(u('u_ratio'), ratio);
        gl.uniform1f(u('u_now'), now);
        gl.uniform1f(u('u_motion'), motion);
        gl.bindVertexArray(pingBuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pingBuf.count);
      }
      gl.bindVertexArray(null);

      // Keep animating while the run is live and while arcs are still drawing in.
      const pending = now < lastBirth + 2.5 || pings.some(pg => !pg.once ? live : now < pg.start + pg.period);
      if (motion && (live || pending)) map.triggerRepaint();
    },
  };
}

/* ───────────────────────────── The controller ───────────────────────────── */

export interface OracleGlobe {
  /** Draws a run (or clears the globe for null). Cheap to call on every event. */
  update(state: RunState | null): void;
  /** Re-adds what a style change removed. */
  ensure(): void;
  destroy(): void;
}

type Feature = GeoJSON.Feature<GeoJSON.Point, Record<string, string | number | boolean>>;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function attachOracle(map: MlMap, onSelect?: (key: string) => void): OracleGlobe {
  const layer = createArcLayer();
  let state: RunState | null = null;
  /** When each link (by id and version) started drawing, on the layer's clock. */
  const births = new Map<string, number>();
  const nodeBirths = new Map<string, number>();
  /** When each panelist started thinking, so their ripple keeps its rhythm across updates. */
  const thinkingSince = new Map<string, number>();
  let focusSince = 0;

  const ensure = () => {
    if (!map.getStyle()) return;
    if (!map.getLayer(ORACLE_ARCS)) map.addLayer(layer);
    if (!map.getSource(NODES)) map.addSource(NODES, { type: 'geojson', data: EMPTY });
    if (!map.getLayer('oracle-node-halo')) {
      map.addLayer({
        id: 'oracle-node-halo', type: 'circle', source: NODES,
        paint: {
          'circle-radius': ['get', 'halo'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.18,
          'circle-blur': 0.7,
          'circle-pitch-alignment': 'map',
        },
      });
    }
    if (!map.getLayer('oracle-node-core')) {
      map.addLayer({
        id: 'oracle-node-core', type: 'circle', source: NODES,
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['==', ['get', 'kind'], 'context'], 0.7, 0.95],
          'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'actor'], 1.5, 1],
          'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'actor'], '#F3EAFF', 'rgba(10,6,20,0.9)'],
        },
      });
    }
    const label = (id: string, filter: FilterSpecification, size: number, minzoom = 0) => {
      if (map.getLayer(id)) return;
      map.addLayer({
        id, type: 'symbol', source: NODES, filter, minzoom,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold'],
          'text-size': size,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-max-width': 12,
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': ['get', 'textColor'],
          'text-halo-color': 'rgba(8,4,18,0.92)',
          'text-halo-width': 1.4,
        },
      });
    };
    label('oracle-label-actor', ['in', ['get', 'kind'], ['literal', ['actor', 'scenario', 'signpost']]], 10);
    label('oracle-label-agent', ['==', ['get', 'kind'], 'agent'], 9, 2.4);
    if (!map.getLayer('oracle-label-forecast')) {
      map.addLayer({
        id: 'oracle-label-forecast', type: 'symbol', source: NODES, filter: ['==', ['get', 'kind'], 'focus'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold'],
          'text-size': 15,
          'text-letter-spacing': 0.08,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#F5ECFF', 'text-halo-color': 'rgba(120,60,220,0.55)', 'text-halo-width': 2.2, 'text-halo-blur': 1.2 },
      });
    }
  };

  const onClick = (e: MapLayerMouseEvent) => {
    const key = e.features?.[0]?.properties?.key;
    if (typeof key === 'string') onSelect?.(key);
  };
  const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const leave = () => { map.getCanvas().style.cursor = ''; };
  map.on('click', 'oracle-node-core', onClick);
  map.on('mouseenter', 'oracle-node-core', enter);
  map.on('mouseleave', 'oracle-node-core', leave);
  const onStyle = () => { ensure(); if (state) draw(state); };
  map.on('style.load', onStyle);

  function draw(s: RunState) {
    const now = clock();
    const pos = new Map<string, LngLat>();
    for (const a of s.actors) if (a.lat !== null && a.lng !== null) pos.set(`a:${a.id}`, [a.lng, a.lat]);
    for (const g of s.agents) if (g.lat !== null && g.lng !== null) pos.set(`g:${g.id}`, [g.lng, g.lat]);
    for (const c of s.context) if (c.lat !== null && c.lng !== null) pos.set(`c:${c.id}`, [c.lng, c.lat]);

    // Arcs: new ones are staggered so a burst (a replayed run, a world model) draws in sequence rather than all at once.
    const fresh = s.links.filter(l => !births.has(`${l.id}|${l.round}|${l.tone}`));
    const gap = fresh.length > 1 ? Math.min(0.14, 3 / fresh.length) : 0;
    fresh.forEach((l, i) => births.set(`${l.id}|${l.round}|${l.tone}`, now + i * gap));
    const arcs: ArcSpec[] = [];
    for (const l of s.links) {
      const from = pos.get(l.from);
      const to = pos.get(l.to);
      if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
      const hex = l.kind === 'evidence' ? ORACLE_COLORS.evidence : ORACLE_COLORS[l.tone];
      arcs.push({ from, to, color: rgb(hex), strength: l.strength, birth: births.get(`${l.id}|${l.round}|${l.tone}`)!, kind: KIND[l.kind] });
    }
    layer.setArcs(arcs);
    layer.setLive(s.status === 'running');

    // Nodes.
    const latest = latestPosts(s);
    const features: Feature[] = [];
    const point = (lng: number, lat: number, props: Record<string, string | number | boolean>): Feature =>
      ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
    for (const c of s.context) {
      if (c.lat === null || c.lng === null) continue;
      features.push(point(c.lng, c.lat, { key: `c:${c.id}`, kind: 'context', label: '', color: ORACLE_COLORS.context, textColor: '#D9D0F0', radius: 2.5, halo: 6 }));
    }
    for (const a of s.actors) {
      if (a.lat === null || a.lng === null) continue;
      features.push(point(a.lng, a.lat, { key: `a:${a.id}`, kind: 'actor', label: a.name, color: ORACLE_COLORS.actor, textColor: '#EFE4FF', radius: 5, halo: 16 }));
    }
    for (const g of s.agents) {
      if (g.lat === null || g.lng === null) continue;
      const p = latest.get(g.id)?.probability ?? null;
      const first = g.name.split(' ')[0];
      features.push(point(g.lng, g.lat, {
        key: `g:${g.id}`, kind: 'agent', label: p === null ? first : `${first} · ${Math.round(p * 100)}%`,
        color: leanColor(p), textColor: '#E2D6FF', radius: 3.6, halo: s.thinking[g.id] ? 14 : 9,
      }));
    }
    if (s.report) {
      for (const sc of s.report.scenarios) {
        if (sc.lat === null || sc.lng === null) continue;
        features.push(point(sc.lng, sc.lat, {
          key: `s:${sc.name}`, kind: 'scenario', label: `${sc.name} · ${Math.round(sc.probability * 100)}%`,
          color: '#E8D5FF', textColor: '#F5ECFF', radius: 4 + 10 * sc.probability, halo: 10 + 26 * sc.probability,
        }));
      }
      for (const sp of s.report.signposts) {
        if (sp.lat === null || sp.lng === null) continue;
        features.push(point(sp.lng, sp.lat, {
          key: `p:${sp.text}`, kind: 'signpost', label: `◆ ${sp.text.length > 40 ? `${sp.text.slice(0, 39)}…` : sp.text}`,
          color: sp.means === 'yes' ? ORACLE_COLORS.yes : ORACLE_COLORS.no, textColor: '#E6DCFA', radius: 3, halo: 8,
        }));
      }
    }
    const focus = s.frame?.focus;
    const last = s.rounds[s.rounds.length - 1];
    const prob = s.report?.probability ?? last?.consensus ?? null;
    if (focus && focus.lat !== null && focus.lng !== null && prob !== null) {
      features.push(point(focus.lng, focus.lat, { key: 'focus', kind: 'focus', label: `◈ ${Math.round(prob * 100)}%${s.report ? '' : ' …'}`, color: '#FFFFFF', textColor: '#FFFFFF', radius: 0, halo: 0 }));
    }
    (map.getSource(NODES) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });

    // Ripples: a node's arrival, a panelist thinking, and the forecast's home while the run is live.
    const pings: Ping[] = [];
    for (const f of features) {
      const key = String(f.properties.key);
      if (f.properties.kind === 'context' || f.properties.kind === 'focus') continue;
      if (!nodeBirths.has(key)) nodeBirths.set(key, now + nodeBirths.size % 12 * 0.05);
      const [lng, lat] = f.geometry.coordinates as LngLat;
      pings.push({ pos: mercator([lng, lat]), color: rgb(String(f.properties.color)), size: 26, start: nodeBirths.get(key)!, period: 1.5, once: true });
    }
    for (const id of [...thinkingSince.keys()]) if (!(id in s.thinking)) thinkingSince.delete(id);
    for (const g of s.agents) {
      if (!(g.id in s.thinking) || g.lat === null || g.lng === null) continue;
      if (!thinkingSince.has(g.id)) thinkingSince.set(g.id, now);
      pings.push({ pos: mercator([g.lng, g.lat]), color: rgb('#D7B8FF'), size: 22, start: thinkingSince.get(g.id)!, period: 1.1, once: false });
    }
    if (s.status === 'running' && focus && focus.lat !== null && focus.lng !== null) {
      focusSince ||= now;
      pings.push({ pos: mercator([focus.lng, focus.lat]), color: rgb('#B388FF'), size: 70, start: focusSince, period: 2.8, once: false });
    }
    layer.setPings(pings);
  }

  ensure();

  return {
    update(next) {
      if (next !== state && next && state && next.startedAt !== state.startedAt) {
        births.clear();
        nodeBirths.clear();
        thinkingSince.clear();
        focusSince = 0;
      }
      state = next;
      ensure();
      if (!next) {
        births.clear();
        nodeBirths.clear();
        thinkingSince.clear();
        focusSince = 0;
        layer.setArcs([]);
        layer.setPings([]);
        layer.setLive(false);
        (map.getSource(NODES) as GeoJSONSource | undefined)?.setData(EMPTY);
        return;
      }
      draw(next);
    },
    ensure,
    destroy() {
      map.off('click', 'oracle-node-core', onClick);
      map.off('mouseenter', 'oracle-node-core', enter);
      map.off('mouseleave', 'oracle-node-core', leave);
      map.off('style.load', onStyle);
      if (!map.getStyle()) return;
      for (const id of [...LAYERS, ORACLE_ARCS]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(NODES)) map.removeSource(NODES);
    },
  };
}

/** A camera that frames a run's actors: the centre of the world model, zoomed to its spread. */
export function frameRun(s: RunState): { lat: number; lng: number; zoom: number } | null {
  const pts = s.actors.filter(a => a.lat !== null && a.lng !== null).map(a => [a.lng!, a.lat!] as LngLat);
  const focus = s.frame?.focus;
  if (!pts.length && (!focus || focus.lat === null || focus.lng === null)) return null;
  // Average on the sphere, so actors either side of the date line centre between them.
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of pts.length ? pts : [[focus!.lng!, focus!.lat!] as LngLat]) {
    const la = (lat * Math.PI) / 180, lo = (lng * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const lng = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  const R = 6371;
  const spread = Math.max(0, ...pts.map(p => {
    const dLat = ((p[1] - lat) * Math.PI) / 180, dLng = ((p[0] - lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((p[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }));
  const zoom = spread > 7000 ? 1.15 : spread > 4000 ? 1.6 : spread > 2000 ? 2.4 : spread > 800 ? 3.3 : 4.3;
  return { lat, lng, zoom };
}
