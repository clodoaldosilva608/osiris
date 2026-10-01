import { describe, it, expect } from 'vitest';
import {
  PAD, PADDED, REF_HEIGHT, REF_WIDTH, TILE,
  applyLut, cloudsTileTemplate, frameTime, matchLut, parseCloudsUrl, referenceFootprint,
  referenceHistogram, referenceUrl, renderClouds, sunElevation, tileBbox, tileDaylight,
  tileHistogram, tileUrl,
} from './live-clouds';

const HALF = 20037508.342789244;
const TIME = '2026-09-22T12:00:00Z'; // equinox noon: the sun is over 0°, 0°
const NOON = Date.parse(TIME);

describe('tileBbox', () => {
  it('covers the whole world at zoom 0', () => {
    expect(tileBbox(0, 0, 0)).toEqual([-HALF, -HALF, HALF, HALF]);
  });

  // y counts down from the north edge, as in every XYZ scheme.
  it('puts tile 1/0/0 in the north-west quarter', () => {
    expect(tileBbox(1, 0, 0)).toEqual([-HALF, 0, 0, HALF]);
    expect(tileBbox(1, 1, 1)).toEqual([0, -HALF, HALF, 0]);
  });

  it('grows by whole pixels of padding', () => {
    const pixel = (2 * HALF) / TILE;
    expect(tileBbox(0, 0, 0, 2)).toEqual([-HALF - 2 * pixel, -HALF - 2 * pixel, HALF + 2 * pixel, HALF + 2 * pixel]);
  });
});

describe('frameTime', () => {
  it('asks for the current hour once NOAA has had time to publish it', () => {
    expect(frameTime(Date.parse('2026-09-30T23:25:10Z'))).toBe('2026-09-30T23:00:00Z');
  });

  /* Just after the hour the new frame isn't up yet. Asking for it would snap
     to last hour's picture and cache it under this hour's URL. */
  it('stays on the previous hour just after the turn', () => {
    expect(frameTime(Date.parse('2026-10-01T00:05:00Z'))).toBe('2026-09-30T23:00:00Z');
  });
});

describe('parseCloudsUrl', () => {
  const template = cloudsTileTemplate('2026-09-30T23:00:00Z');
  const url = (z: number, x: number, y: number) => template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

  it('reads back what the template produces', () => {
    expect(parseCloudsUrl(url(3, 4, 2))).toEqual({ z: 3, x: 4, y: 2, time: '2026-09-30T23:00:00Z' });
  });

  it('rejects a tile outside its zoom level', () => {
    expect(parseCloudsUrl(url(2, 4, 0))).toBeNull();
  });

  it('rejects zooms past the imagery', () => {
    expect(parseCloudsUrl(url(9, 0, 0))).toBeNull();
  });

  it('rejects anything that is not one of ours', () => {
    expect(parseCloudsUrl('osiris-clouds://1/0/0?time=now')).toBeNull();
    expect(parseCloudsUrl('https://example.com/1/0/0')).toBeNull();
  });
});

describe('NOAA requests', () => {
  it('asks for a tile with its padding, in the band wanted', () => {
    const u = new URL(tileUrl('vis', { z: 1, x: 0, y: 0, time: TIME }));
    expect(u.hostname).toBe('nowcoast.noaa.gov');
    expect(u.searchParams.get('LAYERS')).toBe('global_visible_imagery_mosaic');
    expect(u.searchParams.get('BBOX')).toBe(tileBbox(1, 0, 0, PAD).join(','));
    expect(u.searchParams.get('WIDTH')).toBe(String(PADDED));
    expect(u.searchParams.get('TIME')).toBe(TIME);
  });

  it('asks for the reference as one image of the whole world', () => {
    const u = new URL(referenceUrl('ir', TIME));
    expect(u.searchParams.get('LAYERS')).toBe('global_longwave_imagery_mosaic');
    expect(u.searchParams.get('WIDTH')).toBe(String(REF_WIDTH));
    expect(u.searchParams.get('HEIGHT')).toBe(String(REF_HEIGHT));
    const [minx, , maxx] = u.searchParams.get('BBOX')!.split(',').map(Number);
    expect([minx, maxx]).toEqual([-HALF, HALF]);
  });
});

describe('referenceFootprint', () => {
  it('spans the whole reference at zoom 0', () => {
    expect(referenceFootprint(0, 0, 0)).toEqual({ x0: 0, x1: REF_WIDTH, y0: 0, y1: REF_HEIGHT });
  });

  it('puts tile 1/1/0 on the right half, above the equator', () => {
    expect(referenceFootprint(1, 1, 0)).toEqual({ x0: REF_WIDTH / 2, x1: REF_WIDTH, y0: 0, y1: REF_HEIGHT / 2 });
  });
});

/** A padded tile, every pixel the given grey, opaque. */
function tileOf(grey: (i: number, j: number) => number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(PADDED * PADDED * 4);
  for (let j = 0; j < PADDED; j++) {
    for (let i = 0; i < PADDED; i++) {
      const k = (j * PADDED + i) * 4;
      rgba[k] = rgba[k + 1] = rgba[k + 2] = grey(i, j);
      rgba[k + 3] = 255;
    }
  }
  return rgba;
}

describe('matching a tile to the reference', () => {
  const histogram = (values: number[]) => { const h = new Uint32Array(256); for (const v of values) h[v]++; return h; };
  const spread = (from: number, to: number, n = 2000) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));

  it('leaves a tile already on the reference scale as it is', () => {
    const h = histogram(spread(40, 200));
    const lut = matchLut(h, h)!;
    for (const v of [40, 100, 160, 200]) expect(Math.abs(lut[v] - v)).toBeLessThanOrEqual(1);
  });

  /* What NOAA does: the same patch, stretched to fill 0–255 in a tile of its own. */
  it('undoes a stretch', () => {
    const ref = spread(60, 180);
    const stretched = ref.map(v => Math.round(((v - 60) / 120) * 255));
    const lut = matchLut(histogram(stretched), histogram(ref))!;
    expect(Math.abs(lut[0] - 60)).toBeLessThanOrEqual(2);
    expect(Math.abs(lut[128] - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(lut[255] - 180)).toBeLessThanOrEqual(2);
  });

  it('never reverses the order of two greys', () => {
    const lut = matchLut(histogram(spread(0, 255)), histogram(spread(30, 90)))!;
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it('gives up on too few samples', () => {
    expect(matchLut(histogram([10, 20, 30]), histogram(spread(0, 255)))).toBeNull();
  });

  it('counts only the unpadded, covered part of a tile', () => {
    const rgba = tileOf((i, j) => (i < PAD || j < PAD || i >= PAD + TILE || j >= PAD + TILE ? 9 : 100));
    rgba[((PAD * PADDED) + PAD) * 4 + 3] = 0; // one pixel outside the satellites' view
    const h = tileHistogram(rgba);
    expect(h[100]).toBe(TILE * TILE - 1);
    expect(h[9]).toBe(0);
  });

  it('skips the black outside the satellites’ view in the reference', () => {
    const grey = new Uint8Array(REF_WIDTH * REF_HEIGHT).fill(120);
    grey[0] = 0;
    const h = referenceHistogram(grey, { x0: 0, x1: 4, y0: 0, y1: 1 });
    expect(h[120]).toBe(3);
    expect(h[0]).toBe(0);
  });

  it('remaps every channel of a tile', () => {
    const rgba = new Uint8ClampedArray([10, 10, 10, 255]);
    const lut = new Uint8Array(256); lut[10] = 77;
    applyLut(rgba, lut);
    expect([...rgba]).toEqual([77, 77, 77, 255]);
  });
});

describe('sunlight', () => {
  const deg = Math.PI / 180;

  it('puts the sun overhead at 0°, 0° at equinox noon', () => {
    expect(sunElevation(NOON)(0, 0)).toBeGreaterThan(0.99);
  });

  it('has it below the horizon on the far side of the world', () => {
    expect(sunElevation(NOON)(0, 180 * deg)).toBeLessThan(-0.99);
  });

  it('finds a tile under the sun all lit, and the opposite one all dark', () => {
    // At zoom 3, tile 4/3 sits just east of 0°, 0°; tile 0/3 is on the date line.
    expect(tileDaylight(3, 4, 3, NOON)).toBe(1);
    expect(tileDaylight(3, 0, 3, NOON)).toBe(0);
  });
});

describe('renderClouds', () => {
  // Tile 4/3 at zoom 3 is in full daylight at NOON; tile 0/3 is in darkness.
  const day = { z: 3, x: 4, y: 3, time: NOON };
  const night = { z: 3, x: 0, y: 3, time: NOON };
  const px = (out: Uint8ClampedArray, i: number, j: number) => Array.from(out.subarray((j * TILE + i) * 4, (j * TILE + i) * 4 + 4));

  it('draws clear, warm ground as nothing at all', () => {
    const out = renderClouds({ ir: tileOf(() => 70), vis: null, ...night });
    expect(out.every((v, k) => k % 4 !== 3 || v === 0)).toBe(true);
  });

  it('draws a deck of cold cloud opaque, and evenly lit when its top is flat', () => {
    const out = renderClouds({ ir: tileOf(() => 230), vis: null, ...night });
    const [r, g, b, a] = px(out, 128, 128);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(200);
    expect(px(out, 10, 10)).toEqual([r, g, b, a]);
  });

  /* A ridge whose crest runs north-east to south-west through the middle of the
     tile. Rows count southward, so its north-west flank is up and to the left. */
  it('lights the slope facing north-west and shades the one facing away', () => {
    const crest = 2 * (PAD + 128);
    const ridge = (i: number, j: number) => 255 - Math.min(150, Math.abs(i + j - crest) * 3);
    const out = renderClouds({ ir: tileOf(ridge), vis: null, ...night });
    const facingLight = px(out, 118, 118);
    const facingAway = px(out, 138, 138);
    expect(facingLight[0]).toBeGreaterThan(facingAway[0] + 20);
  });

  it('casts a shadow to the south-east of a cloud and none to the north-west', () => {
    const centre = PAD + 128;
    const blob = (i: number, j: number) => (Math.hypot(i - centre, j - centre) < 30 ? 240 : 60);
    const out = renderClouds({ ir: tileOf(blob), vis: null, ...night });
    // Just clear of the cloud's edge, on either diagonal.
    const [, , , southEast] = px(out, 128 + 23, 128 + 23);
    const [, , , northWest] = px(out, 128 - 23, 128 - 23);
    expect(southEast).toBeGreaterThan(20);
    expect(northWest).toBe(0);
  });

  /* The Sahara is as bright as cloud in visible light, but far too hot to be cloud. */
  it('leaves hot, bright desert clear by day', () => {
    const out = renderClouds({ ir: tileOf(() => 30), vis: tileOf(() => 200), ...day });
    expect(px(out, 128, 128)[3]).toBe(0);
  });

  /* Low marine cloud is barely colder than the sea, so infrared misses it; daylight shows it. */
  it('shows low cloud that only visible light can see, but only by day', () => {
    const lowCloud = { ir: tileOf(() => 85), vis: tileOf(() => 190) };
    expect(renderClouds({ ...lowCloud, ...day })[(128 * TILE + 128) * 4 + 3]).toBeGreaterThan(200);
    expect(renderClouds({ ...lowCloud, vis: null, ...night })[(128 * TILE + 128) * 4 + 3]).toBe(0);
  });
});
