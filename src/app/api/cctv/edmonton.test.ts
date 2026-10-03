import { describe, it, expect } from 'vitest';
import { parseEdmonton, fetchEdmontonCameras } from './edmonton';

/** One GetCameras row, shaped as the city's page method returns it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    __type: 'TrafficCameras.TrafficCamerasServices.dtoCamera',
    ExtensionData: {},
    Code: 106,
    Forge: 1,
    Latitude: '53.4573',
    Longitude: '-113.589',
    MMSUrl: 'cityed1-winkcdn1.winkcdn.com',
    PrimaryRoad: '23 Avenue',
    SecondaryRoad: 'Terwillegar Drive',
    SortOrder: 0,
    Status: '1',
    StatusComment: 'Online',
    StreamCode: 'WF06-3E67-A9A3-DD98-BCE9_ab',
    StreamCodeMask: '23ave_terw',
    StreamCodeMaskEnabled: true,
    ...overrides,
  };
}
const payload = (...rows: unknown[]) => ({ d: rows });

describe('parseEdmonton', () => {
  it('assembles the HLS playlist from host, forge and stream code', () => {
    expect(parseEdmonton(payload(row()))).toEqual([{
      id: 'yeg-106',
      lat: 53.4573,
      lng: -113.589,
      name: '23 Avenue & Terwillegar Drive',
      city: 'Edmonton',
      country: 'Canada',
      stream_url: 'https://cityed1-winkcdn1.winkcdn.com/1/public/hls/WF06-3E67-A9A3-DD98-BCE9_ab.m3u8',
      stream_type: 'hls',
      external_url: 'https://edmontontrafficcam.com/',
      source: 'City of Edmonton',
    }]);
  });

  it('uses the stream code, not the mask — only the code resolves', () => {
    const [cam] = parseEdmonton(payload(row()));
    expect(cam.stream_url).not.toContain('23ave_terw');
  });

  it('drops cameras the city marks offline', () => {
    expect(parseEdmonton(payload(row({ Status: '0', StatusComment: 'Offline' })))).toEqual([]);
  });

  it('drops rows it cannot place or play', () => {
    expect(parseEdmonton(payload(row({ Latitude: '' })))).toEqual([]);
    expect(parseEdmonton(payload(row({ Latitude: '51.0447', Longitude: '-114.0719' })))).toEqual([]); // Calgary
    expect(parseEdmonton(payload(row({ StreamCode: '' })))).toEqual([]);
    expect(parseEdmonton(payload(row({ StreamCode: '../evil' })))).toEqual([]);
    expect(parseEdmonton(payload(row({ Forge: undefined })))).toEqual([]);
    expect(parseEdmonton(payload(row({ Code: undefined })))).toEqual([]);
  });

  it('only builds stream URLs on the city stream host', () => {
    expect(parseEdmonton(payload(row({ MMSUrl: 'example.com' })))).toEqual([]);
    expect(parseEdmonton(payload(row({ MMSUrl: 'winkcdn.com.example.com' })))).toEqual([]);
  });

  it('keeps one camera per code', () => {
    expect(parseEdmonton(payload(row(), row()))).toHaveLength(1);
  });

  it('falls back to a placeholder name when the roads are missing', () => {
    const [cam] = parseEdmonton(payload(row({ PrimaryRoad: null, SecondaryRoad: '' })));
    expect(cam.name).toBe('Edmonton Camera 106');
  });

  it('returns nothing for a payload without rows', () => {
    expect(parseEdmonton(null)).toEqual([]);
    expect(parseEdmonton({})).toEqual([]);
    expect(parseEdmonton({ d: 'error' })).toEqual([]);
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real city endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchEdmontonCameras (live)', () => {
  liveIt('returns Edmonton cameras with playable stream URLs', async () => {
    const cams = await fetchEdmontonCameras();
    expect(cams.length).toBeGreaterThan(30);
    for (const cam of cams) {
      expect(cam.stream_url).toMatch(/^https:\/\/[\w.-]+\.winkcdn\.com\/\d+\/public\/hls\/[\w-]+\.m3u8$/);
    }
  }, 20000);
});
