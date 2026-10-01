import type { AddProtocolAction } from 'maplibre-gl';

/**
 * OSIRIS — Live Clouds: NOAA's global infrared satellite mosaic, drawn as cloud.
 *
 * The source is GMGSI, the Global Mosaic of Geostationary Satellite Imagery:
 * every weather satellite in geostationary orbit stitched into one picture of
 * the world, refreshed hourly and served by NOAA nowCOAST as a WMS. It is the
 * thermal infrared band, not visible light, so the night side has clouds too.
 *
 * That imagery is opaque grey: cold cloud tops bright, warm ground and sea dark.
 * Laid over the map as it comes, it would grey out everything under it. So each
 * tile is recoloured in the browser as it arrives — white, as opaque as the
 * pixel is bright — and clear sky comes out transparent.
 */

export const CLOUDS_PROTOCOL = 'osiris-clouds';
export const CLOUDS_SOURCE = 'live-clouds';
export const CLOUDS_LAYER = 'live-clouds';
export const CLOUDS_ATTRIBUTION = 'Clouds © NOAA/NESDIS GMGSI';
/** The imagery is about 3 km a pixel; past zoom 6 a tile would only be upscaled. */
export const CLOUDS_MAX_ZOOM = 6;

const WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/wms';
const WMS_LAYER = 'global_longwave_imagery_mosaic';
const TILE = 256;
/** Half the width of the Web Mercator world, in metres. */
const HALF = 20037508.342789244;
/** How long after the hour NOAA has that hour's frame up; it was 13 minutes when checked. */
const PUBLISH_DELAY_MS = 20 * 60_000;

/** Brightness at which cloud starts to show, and at which it is fully opaque. */
const CLEAR = 95;
const OVERCAST = 190;

/** A tile's Web Mercator bounds, in the order WMS wants: minx, miny, maxx, maxy. */
export function tileBbox(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF) / 2 ** z;
  const minx = -HALF + x * size;
  const maxy = HALF - y * size;
  return [minx, maxy - size, minx + size, maxy];
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
export function parseCloudsUrl(url: string): { z: number; x: number; y: number; time: string } | null {
  const match = /^osiris-clouds:\/\/(\d{1,2})\/(\d+)\/(\d+)\?time=(\d{4}-\d\d-\d\dT\d\d%3A00%3A00Z)$/.exec(url);
  if (!match) return null;
  const [z, x, y] = match.slice(1, 4).map(Number);
  if (z > CLOUDS_MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y, time: decodeURIComponent(match[4]) };
}

/** NOAA's GetMap request for one tile of one frame. */
export function wmsUrl({ z, x, y, time }: { z: number; x: number; y: number; time: string }): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
    LAYERS: WMS_LAYER, STYLES: '', FORMAT: 'image/png', TRANSPARENT: 'true',
    CRS: 'EPSG:3857', BBOX: tileBbox(z, x, y).join(','),
    WIDTH: String(TILE), HEIGHT: String(TILE), TIME: time,
  });
  return `${WMS}?${params.toString()}`;
}

/** Opacity, 0 to 255, for an infrared brightness. Eased, so thin cloud fades in rather than cutting out. */
export function cloudAlpha(gray: number): number {
  const t = Math.min(1, Math.max(0, (gray - CLEAR) / (OVERCAST - CLEAR)));
  return Math.round(255 * t * t * (3 - 2 * t));
}

/** Recolour a tile's RGBA pixels in place: white, opaque where the cloud is cold. */
export function toCloud(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    // The imagery is greyscale, so red alone is the brightness. Outside the
    // satellites' coverage it is already transparent, and stays so.
    const alpha = (cloudAlpha(rgba[i]) * rgba[i + 3]) / 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
    rgba[i + 3] = alpha;
  }
}

const loadTile: AddProtocolAction = async (request, controller) => {
  const tile = parseCloudsUrl(request.url);
  if (!tile) throw new Error('Invalid clouds tile');
  const response = await fetch(wmsUrl(tile), { signal: controller.signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Clouds tile HTTP ${response.status}`);
  const image = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  image.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  toCloud(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  // A frame never changes once published; the URL moves on when the next one lands.
  return { data: await createImageBitmap(canvas), cacheControl: 'max-age=3600' };
};

let installed = false;
export function installCloudsProtocol(addProtocol: (name: string, handler: AddProtocolAction) => void) {
  if (installed) return;
  addProtocol(CLOUDS_PROTOCOL, loadTile);
  installed = true;
}
