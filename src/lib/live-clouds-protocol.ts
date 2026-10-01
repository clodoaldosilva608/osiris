import type { AddProtocolAction } from 'maplibre-gl';
import { CLOUDS_PROTOCOL, parseCloudsUrl } from './live-clouds';

/**
 * OSIRIS — Live Clouds on the main thread: MapLibre asks for a tile by its
 * osiris-clouds:// URL, and the worker (live-clouds.worker.ts) draws it.
 */

type Waiting = { resolve: (bitmap: ImageBitmap) => void; reject: (error: unknown) => void };

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, Waiting>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./live-clouds.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
    const job = waiting.get(data.id);
    if (!job) { data.bitmap?.close(); return; }
    waiting.delete(data.id);
    if (data.bitmap) job.resolve(data.bitmap);
    else job.reject(new Error(data.error || 'Clouds tile failed'));
  };
  // A worker that never starts fails every tile, not just the next one.
  worker.onerror = event => {
    for (const job of waiting.values()) job.reject(new Error(event.message || 'Clouds worker failed'));
    waiting.clear();
  };
  return worker;
}

const loadTile: AddProtocolAction = (request, controller) => {
  const tile = parseCloudsUrl(request.url);
  if (!tile) return Promise.reject(new Error('Invalid clouds tile'));
  const id = ++nextId;
  const target = getWorker();
  return new Promise((resolve, reject) => {
    waiting.set(id, {
      // A frame never changes once published; the URL moves on when the next one lands.
      resolve: bitmap => resolve({ data: bitmap, cacheControl: 'max-age=3600' }),
      reject,
    });
    controller.signal.addEventListener('abort', () => {
      if (!waiting.delete(id)) return;
      target.postMessage({ type: 'cancel', id });
      reject(controller.signal.reason);
    }, { once: true });
    target.postMessage({ type: 'tile', id, tile });
  });
};

let installed = false;
export function installCloudsProtocol(addProtocol: (name: string, handler: AddProtocolAction) => void) {
  if (installed) return;
  addProtocol(CLOUDS_PROTOCOL, loadTile);
  installed = true;
}
