import { describe, it, expect } from 'vitest';
import { tileBbox, frameTime, cloudsTileTemplate, parseCloudsUrl, wmsUrl, cloudAlpha, toCloud } from './live-clouds';

const HALF = 20037508.342789244;

describe('tileBbox', () => {
  it('covers the whole world at zoom 0', () => {
    expect(tileBbox(0, 0, 0)).toEqual([-HALF, -HALF, HALF, HALF]);
  });

  // y counts down from the north edge, as in every XYZ scheme.
  it('puts tile 1/0/0 in the north-west quarter', () => {
    expect(tileBbox(1, 0, 0)).toEqual([-HALF, 0, 0, HALF]);
    expect(tileBbox(1, 1, 1)).toEqual([0, -HALF, HALF, 0]);
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

describe('wmsUrl', () => {
  it('asks NOAA for that tile of that frame', () => {
    const u = new URL(wmsUrl({ z: 1, x: 0, y: 0, time: '2026-09-30T23:00:00Z' }));
    expect(u.hostname).toBe('nowcoast.noaa.gov');
    expect(u.searchParams.get('BBOX')).toBe(tileBbox(1, 0, 0).join(','));
    expect(u.searchParams.get('CRS')).toBe('EPSG:3857');
    expect(u.searchParams.get('TIME')).toBe('2026-09-30T23:00:00Z');
  });
});

describe('cloudAlpha', () => {
  it('leaves warm, clear ground transparent', () => {
    expect(cloudAlpha(60)).toBe(0);
  });

  it('makes the coldest cloud tops fully opaque', () => {
    expect(cloudAlpha(200)).toBe(255);
  });

  it('rises with brightness in between', () => {
    expect(cloudAlpha(120)).toBeGreaterThan(0);
    expect(cloudAlpha(160)).toBeGreaterThan(cloudAlpha(120));
    expect(cloudAlpha(160)).toBeLessThan(255);
  });
});

describe('toCloud', () => {
  it('turns grey into white, with opacity from the brightness', () => {
    const px = new Uint8ClampedArray([60, 60, 60, 255, 200, 200, 200, 255]);
    toCloud(px);
    expect([...px]).toEqual([255, 255, 255, 0, 255, 255, 255, 255]);
  });

  // Outside the satellites' coverage NOAA sends transparent pixels.
  it('keeps pixels outside the coverage transparent', () => {
    const px = new Uint8ClampedArray([200, 200, 200, 0]);
    toCloud(px);
    expect(px[3]).toBe(0);
  });
});
