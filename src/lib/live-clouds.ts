/**
 * OSIRIS — Live Clouds: NOAA's global satellite mosaic, drawn as lit cloud.
 *
 * The source is GMGSI, the Global Mosaic of Geostationary Satellite Imagery:
 * every weather satellite in geostationary orbit stitched into one picture of
 * the world, refreshed hourly and served by NOAA nowCOAST as a WMS. Two of its
 * bands are used. Thermal infrared shows cloud day and night, and how cold a
 * cloud top is says how high it reaches. Visible light shows the cloud itself,
 * texture and sunlit relief, but only on the day side.
 *
 * Everything here is pure: the worker (live-clouds.worker.ts) fetches and
 * decodes, and these functions turn grey satellite pixels into cloud.
 */

export const CLOUDS_PROTOCOL = 'osiris-clouds';
export const CLOUDS_SOURCE = 'live-clouds';
export const CLOUDS_LAYER = 'live-clouds';
export const CLOUDS_ATTRIBUTION = 'Clouds © NOAA/NESDIS GMGSI';
/** The imagery is about 3 km a pixel, which zoom 6 already shows in full. */
export const CLOUDS_MAX_ZOOM = 6;

export type Band = 'ir' | 'vis';
const LAYERS: Record<Band, string> = {
  ir: 'global_longwave_imagery_mosaic',
  vis: 'global_visible_imagery_mosaic',
};
const WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';

export const TILE = 256;
/**
 * Pixels fetched beyond each edge of a tile. Relief and shadows read their
 * neighbours, so without this every tile seam would show as a lit edge.
 */
export const PAD = 8;
export const PADDED = TILE + 2 * PAD;

/** Half the width of the Web Mercator world, in metres. */
const HALF = 20037508.342789244;
const EARTH_RADIUS = 6378137;

/** The world reference image. The mosaic stops near 72.7° north and south; it covers that band. */
export const REF_WIDTH = 2048;
export const REF_HEIGHT = 1230;
const REF_HALF_HEIGHT = (HALF * REF_HEIGHT) / REF_WIDTH;

/** How long after the hour NOAA has that hour's frame up; it was 13 minutes when checked. */
const PUBLISH_DELAY_MS = 20 * 60_000;

export interface Tile { z: number; x: number; y: number; time: string }

/** A tile's Web Mercator bounds, grown by `pad` pixels a side: minx, miny, maxx, maxy. */
export function tileBbox(z: number, x: number, y: number, pad = 0): [number, number, number, number] {
  const size = (2 * HALF) / 2 ** z;
  const px = (size / TILE) * pad;
  const minx = -HALF + x * size;
  const maxy = HALF - y * size;
  return [minx - px, maxy - size - px, minx + size + px, maxy + px];
}

/**
 * The newest hourly frame NOAA should have published by `now`, as a WMS TIME.
 * The server snaps to the nearest frame it holds, but asking for an hour before
 * it exists would cache last hour's picture under this hour's name.
 */
export function frameTime(now: number = Date.now()): string {
  const t = new Date(now - PUBLISH_DELAY_MS);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString().replace('.000Z', 'Z');
}

/** The source's tile URL. The frame time is in it, so a new frame means new tiles. */
export function cloudsTileTemplate(time: string): string {
  return `${CLOUDS_PROTOCOL}://{z}/{x}/{y}?time=${encodeURIComponent(time)}`;
}

/** The z/x/y and frame of one of our tile URLs, or null for anything else. */
export function parseCloudsUrl(url: string): Tile | null {
  const match = /^osiris-clouds:\/\/(\d{1,2})\/(\d+)\/(\d+)\?time=(\d{4}-\d\d-\d\dT\d\d%3A00%3A00Z)$/.exec(url);
  if (!match) return null;
  const [z, x, y] = match.slice(1, 4).map(Number);
  if (z > CLOUDS_MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y, time: decodeURIComponent(match[4]) };
}

function getMap(band: Band, bbox: number[], width: number, height: number, time: string, format: string): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
    LAYERS: LAYERS[band], STYLES: '', FORMAT: format, TRANSPARENT: 'true', BGCOLOR: '0x000000',
    CRS: 'EPSG:3857', BBOX: bbox.join(','),
    WIDTH: String(width), HEIGHT: String(height), TIME: time,
  });
  return `${WMS}?${params.toString()}`;
}

/** One tile of one band, with its padding. */
export function tileUrl(band: Band, { z, x, y, time }: Tile): string {
  return getMap(band, tileBbox(z, x, y, PAD), PADDED, PADDED, time, 'image/png');
}

/** The whole world in one band, once a frame — the scale every tile is matched to. */
export function referenceUrl(band: Band, time: string): string {
  return getMap(band, [-HALF, -REF_HALF_HEIGHT, HALF, REF_HALF_HEIGHT], REF_WIDTH, REF_HEIGHT, time, 'image/jpeg');
}

/* ── One scale for every tile ──────────────────────────────────────────────
   NOAA stretches the contrast of every image it serves across that image
   alone. The same cloud comes out a different grey in each tile — up to a
   quarter of the range apart — so thresholds drift and every seam shows. Its
   firewall turns away a request that brings its own style, and its WCS
   publishes nothing, so the raw values are out of reach.

   The stretch is one monotonic curve per image, though, and a curve like that
   can be undone by matching histograms. Each frame, one image of the whole
   world is fetched: a single stretch, the same everywhere. Each tile's greys
   are then mapped, quantile for quantile, onto the greys of the same patch of
   that image. */

/** Grey levels of a tile's unpadded pixels, skipping those outside the satellites' view. */
export function tileHistogram(rgba: Uint8ClampedArray): Uint32Array {
  const hist = new Uint32Array(256);
  for (let j = PAD; j < PAD + TILE; j++) {
    for (let i = PAD; i < PAD + TILE; i++) {
      const k = (j * PADDED + i) * 4;
      if (rgba[k + 3] > 0) hist[rgba[k]]++;
    }
  }
  return hist;
}

/** Where a tile falls on the reference image, in its pixels, clipped to it. */
export function referenceFootprint(z: number, x: number, y: number) {
  const [minx, miny, maxx, maxy] = tileBbox(z, x, y);
  const toX = (m: number) => ((m + HALF) / (2 * HALF)) * REF_WIDTH;
  const toY = (m: number) => ((REF_HALF_HEIGHT - m) / (2 * REF_HALF_HEIGHT)) * REF_HEIGHT;
  return {
    x0: Math.max(0, Math.floor(toX(minx))), x1: Math.min(REF_WIDTH, Math.ceil(toX(maxx))),
    y0: Math.max(0, Math.floor(toY(maxy))), y1: Math.min(REF_HEIGHT, Math.ceil(toY(miny))),
  };
}

/**
 * Grey levels of the reference under a footprint. The reference is a JPEG, with
 * no transparency, so the black outside the satellites' view is skipped by value.
 */
export function referenceHistogram(grey: Uint8Array, rect: { x0: number; x1: number; y0: number; y1: number }): Uint32Array {
  const hist = new Uint32Array(256);
  for (let j = rect.y0; j < rect.y1; j++) {
    for (let i = rect.x0; i < rect.x1; i++) {
      const v = grey[j * REF_WIDTH + i];
      if (v > 3) hist[v]++;
    }
  }
  return hist;
}

/** Fewer samples than this and a histogram says little; the tile is drawn as served. */
const MIN_SAMPLES = 64;

/**
 * A table from a tile's grey levels to the reference's: each level goes to the
 * reference grey at the same quantile. Null when either side has too little to go on.
 */
export function matchLut(tile: Uint32Array, ref: Uint32Array): Uint8Array | null {
  let tn = 0, rn = 0;
  for (let v = 0; v < 256; v++) { tn += tile[v]; rn += ref[v]; }
  if (tn < MIN_SAMPLES || rn < MIN_SAMPLES) return null;

  const lut = new Uint8Array(256);
  let below = 0;  // tile pixels darker than the current level
  let r = 0;      // reference level the quantile has reached
  let rBelow = 0; // reference pixels darker than r
  for (let v = 0; v < 256; v++) {
    const q = (below + tile[v] / 2) / tn; // mid-rank, so a level maps to its centre
    below += tile[v];
    while (r < 255 && (rBelow + ref[r]) / rn < q) { rBelow += ref[r]; r++; }
    const within = ref[r] ? (q * rn - rBelow) / ref[r] : 0.5;
    lut[v] = Math.max(0, Math.min(255, Math.round(r - 0.5 + Math.min(1, Math.max(0, within)))));
  }
  return lut;
}

/** Remap a tile's greys in place. */
export function applyLut(rgba: Uint8ClampedArray, lut: Uint8Array): void {
  for (let k = 0; k < rgba.length; k += 4) {
    rgba[k] = rgba[k + 1] = rgba[k + 2] = lut[rgba[k]];
  }
}

/* ── Sunlight ─────────────────────────────────────────────────────────────── */

/**
 * The cosine of the sun's zenith angle anywhere on Earth at `time`: above zero
 * by day. The same approximation the map draws its night shade with, so the
 * visible band fades out exactly where the shade begins.
 */
export function sunElevation(time: number): (latRad: number, lngRad: number) => number {
  const { sinDec, cosDec, subsolar } = sunTerms(time);
  return (lat, lng) => Math.sin(lat) * sinDec + Math.cos(lat) * cosDec * Math.cos(lng - subsolar);
}

/** The sun's declination, as sine and cosine, and the longitude it is overhead at, in radians. */
function sunTerms(time: number) {
  const now = new Date(time);
  const dayOfYear = Math.floor((time - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
  const dec = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10)) * Math.PI) / 180;
  const subsolar = ((12 - (now.getUTCHours() + now.getUTCMinutes() / 60)) * 15 * Math.PI) / 180;
  return { sinDec: Math.sin(dec), cosDec: Math.cos(dec), subsolar };
}

/** Latitude and longitude, in radians, of each row and column of a padded tile. */
function tileGrid(z: number, x: number, y: number) {
  const size = (2 * HALF) / 2 ** z;
  const px = size / TILE;
  const lat = new Float64Array(PADDED), lng = new Float64Array(PADDED);
  for (let n = 0; n < PADDED; n++) {
    const my = HALF - y * size - (n - PAD + 0.5) * px;
    lat[n] = 2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2;
    lng[n] = (-HALF + x * size + (n - PAD + 0.5) * px) / EARTH_RADIUS;
  }
  return { lat, lng };
}

/** How much of a tile is in daylight, 0 to 1, from a 5 × 5 sample — enough to skip the visible band at night. */
export function tileDaylight(z: number, x: number, y: number, time: number): number {
  const { lat, lng } = tileGrid(z, x, y);
  const sun = sunElevation(time);
  let lit = 0;
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 5; b++) {
      const j = PAD + Math.round((a * (TILE - 1)) / 4), i = PAD + Math.round((b * (TILE - 1)) / 4);
      if (sun(lat[j], lng[i]) > DAWN) lit++;
    }
  }
  return lit / 25;
}

/* ── Drawing the cloud ────────────────────────────────────────────────────── */

/** Infrared grey, on the reference's scale, where cloud starts and where it is solid. */
const IR_CLEAR = 105;
const IR_SOLID = 200;
/**
 * Height keeps rising past solid, up to here. Opacity tops out well below the
 * coldest storm tops, and a height that topped out with it left every storm a
 * flat white disc with nothing for the light to catch.
 */
const IR_TOP = 250;
/** Visible grey where cloud starts and where it is solid. */
const VIS_CLEAR = 110;
const VIS_SOLID = 180;
/**
 * Infrared grey below which ground is too hot to be cloud. Deserts are as
 * bright as cloud in visible light; this keeps the Sahara off the map while
 * leaving low marine cloud, which is cool but not cold.
 */
const IR_HOT = 55;
/** Sun elevations, as cosines, over which the visible band fades in after dawn. */
const DAWN = 0.03;
const DAY = 0.2;
/**
 * Sun-angle correction: under a sun higher than HIGH_SUN visible light is taken
 * as it comes; lower down it is brightened, up to 1 / LOW_SUN at the horizon.
 */
const HIGH_SUN = 0.5;
const LOW_SUN = 0.4;
/** How strongly the visible band's fine detail marks the cloud, and over what radius "fine" is judged. */
const TEXTURE = 2.2;
const TEXTURE_RADIUS = 4;

/**
 * How strongly cloud-top height shapes the light at zoom 4. Closer in, each
 * pixel spans less ground, so the same tower is a gentler slope per pixel; the
 * relief grows with zoom to keep it standing up.
 */
const RELIEF = 10;
const RELIEF_PER_ZOOM = 1.5;
/** How much lower cloud sitting among higher cloud is darkened — the gaps between towers. */
const CAVITY = 1.6;
/** Radius, in pixels, of the neighbourhood those gaps are measured against. */
const CAVITY_RADIUS = 6;
/** Toward the light: from the north-west and 40° up, with y pointing south as image rows do. */
const LIGHT = (() => { const v = [-1, -1, 1.2], n = Math.hypot(...v); return v.map(c => c / n); })();
/** Brightness of flat cloud, and how far slopes swing it either way. */
const FLAT = 0.84;
const SWING = 1.6;
/** Ground shadow: how dark, and how far south-east of its cloud, in pixels. */
const SHADOW = 0.42;
const SHADOW_OFFSET = 4;
/** Shaded cloud is a cool grey, lit cloud white. */
const SHADE_RGB = [112, 126, 148];
const SHADOW_RGB = [2, 5, 14];

const smooth = (edge0: number, edge1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Box blur of radius `r` over a square `w` wide, separable, edges clamped. Writes into `out`. */
function boxBlur(src: Float32Array, out: Float32Array, tmp: Float32Array, w: number, r: number) {
  const n = 2 * r + 1, last = w - 1;
  for (let j = 0; j < w; j++) {
    const row = j * w;
    let sum = 0;
    for (let d = -r; d <= r; d++) sum += src[row + Math.min(last, Math.max(0, d))];
    for (let i = 0; i < w; i++) {
      tmp[row + i] = sum / n;
      sum += src[row + Math.min(last, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < w; i++) {
    let sum = 0;
    for (let d = -r; d <= r; d++) sum += tmp[Math.min(last, Math.max(0, d)) * w + i];
    for (let j = 0; j < w; j++) {
      out[j * w + i] = sum / n;
      sum += tmp[Math.min(last, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i];
    }
  }
}

/** Scratch space, reused tile to tile. */
const N = PADDED * PADDED;
const alpha = new Float32Array(N), height = new Float32Array(N), seen = new Float32Array(N), daylight = new Float32Array(N);
const alphaSoft = new Float32Array(N), heightSoft = new Float32Array(N), heightWide = new Float32Array(N), seenWide = new Float32Array(N), scratch = new Float32Array(N);

export interface CloudTile {
  /** Infrared, RGBA, PADDED × PADDED, greys already on the reference's scale. */
  ir: Uint8ClampedArray;
  /** Visible, the same, or null when the tile is all night. */
  vis: Uint8ClampedArray | null;
  z: number; x: number; y: number;
  /** The frame's time, in ms, for the sun. */
  time: number;
}

/**
 * The finished tile, RGBA, TILE × TILE.
 *
 * Opacity comes from infrared — the colder, the thicker — and by day from
 * visible light too, which also catches low cloud infrared can't tell from the
 * sea. Brightness comes from relief: cloud-top height, read off infrared, lit
 * from the north-west, so towering storms stand up off the map, with lower
 * cloud in the gaps between them falling into shade. By day the fine detail of
 * the visible band — real sunlit texture — is laid over that. Each cloud then casts a soft
 * shadow south-east onto whatever is beneath it.
 */
export function renderClouds({ ir, vis, z, x, y, time }: CloudTile): Uint8ClampedArray<ArrayBuffer> {
  // Sun elevation is separable: a term per row plus a term per row times one per column.
  const { lat, lng } = tileGrid(z, x, y);
  const { sinDec, cosDec, subsolar } = sunTerms(time);
  const rowSin = lat.map(l => Math.sin(l) * sinDec);
  const rowCos = lat.map(l => Math.cos(l) * cosDec);
  const colCos = lng.map(l => Math.cos(l - subsolar));

  for (let j = 0; j < PADDED; j++) {
    for (let i = 0; i < PADDED; i++) {
      const k = j * PADDED + i, p = k * 4;
      const covered = ir[p + 3] / 255;
      const cold = smooth(IR_CLEAR, IR_SOLID, ir[p]);
      let a = cold;
      if (vis && vis[p + 3] > 0) {
        const elevation = rowSin[j] + rowCos[j] * colCos[i];
        const day = smooth(DAWN, DAY, elevation);
        if (day > 0) {
          // A low sun lights cloud dimly; divide that out, as satellite
          // imagery is corrected for sun angle, or evening cloud goes grey.
          const v = Math.min(255, vis[p] / (LOW_SUN + (1 - LOW_SUN) * smooth(0, HIGH_SUN, elevation)));
          a = Math.max(a, day * smooth(VIS_CLEAR, VIS_SOLID, v) * smooth(IR_HOT, IR_HOT + 20, ir[p]));
          seen[k] = v / 255;
        } else {
          seen[k] = 0;
        }
        daylight[k] = day;
      } else {
        seen[k] = daylight[k] = 0;
      }
      alpha[k] = a * covered;
      height[k] = Math.min(1, Math.max(0, (ir[p] - IR_CLEAR) / (IR_TOP - IR_CLEAR)));
    }
  }

  boxBlur(alpha, alphaSoft, scratch, PADDED, 1);
  if (vis) boxBlur(seen, seenWide, scratch, PADDED, TEXTURE_RADIUS);
  // Radius 2: the infrared comes in whole grey steps, and relief would light each step as a ridge.
  boxBlur(height, heightSoft, scratch, PADDED, 2);
  boxBlur(height, heightWide, scratch, PADDED, CAVITY_RADIUS);
  const relief = RELIEF * RELIEF_PER_ZOOM ** (z - 4);

  const out = new Uint8ClampedArray(TILE * TILE * 4);
  const [lx, ly, lz] = LIGHT;
  const back = SHADOW_OFFSET * PADDED + SHADOW_OFFSET; // index step to the cloud that shades a pixel
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const k = (j + PAD) * PADDED + i + PAD;
      const o = (j * TILE + i) * 4;
      const a = alphaSoft[k];
      const s = alphaSoft[k - back] * SHADOW * (1 - a);
      const total = a + s;
      if (total < 0.004) continue; // already transparent

      // Surface normal of the cloud tops, from the height field's slope. Thin
      // cloud — cirrus, veils — is lit nearly flat: it has no tops to catch the
      // light, and relief made a cirrus plume read as a field of cumulus.
      const bumps = relief * a * a;
      const dx = (heightSoft[k + 1] - heightSoft[k - 1]) * 0.5 * bumps;
      const dy = (heightSoft[k + PADDED] - heightSoft[k - PADDED]) * 0.5 * bumps;
      const facing = (-dx * lx - dy * ly + lz) / Math.sqrt(dx * dx + dy * dy + 1);
      const occlusion = 1 - Math.min(0.6, CAVITY * Math.max(0, heightWide[k] - heightSoft[k]));
      // By day, the visible band's own detail: how much brighter or darker each
      // pixel is than its surroundings. Only the detail — how thin a cloud is
      // already shows as transparency, and greying it as well made veils smoky.
      const texture = vis ? 1 + daylight[k] * TEXTURE * (seen[k] - seenWide[k]) : 1;
      const lum = Math.min(1, Math.max(0, (FLAT + SWING * (facing - lz)) * occlusion * texture));

      const r = SHADE_RGB[0] + (255 - SHADE_RGB[0]) * lum;
      const g = SHADE_RGB[1] + (255 - SHADE_RGB[1]) * lum;
      const b = SHADE_RGB[2] + (255 - SHADE_RGB[2]) * lum;
      out[o] = (r * a + SHADOW_RGB[0] * s) / total;
      out[o + 1] = (g * a + SHADOW_RGB[1] * s) / total;
      out[o + 2] = (b * a + SHADOW_RGB[2] * s) / total;
      out[o + 3] = Math.min(1, total) * 255;
    }
  }
  return out;
}
