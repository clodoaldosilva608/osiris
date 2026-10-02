import { getRun } from '@/lib/osi/runs';
import { askPrediction, credentials, disabled, disabledResponse, fail, json, limited, readBody } from '@/lib/osi/service';

/**
 * OSIRIS OSI — talk to the simulation after (or during) a run.
 *
 * POST /api/osi/runs/{id}/ask
 *   headers  X-OSI-Key (or Authorization: Bearer); X-OSI-Provider and X-OSI-Model default to the run's
 *   body     { target?: "report" | <panelist id>, message }
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 75;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (disabled()) return disabledResponse();
  const run = getRun((await params).id);
  if (!run) return fail(404, 'No such run.');
  if (limited(req, 'ask', 20)) return fail(429, 'Too many questions. Wait a minute.');
  const body = await readBody(req, 8_000);
  if (!body) return fail(400, 'Send a JSON body: { "target": "report", "message": "…" }.');
  const creds = credentials(req, body);
  if ('error' in creds) return fail(400, creds.error);

  const asked = await askPrediction(run, body.target, body.message, creds, req.signal);
  if (!asked.ok) return fail(asked.status, asked.error);
  return json({ id: run.id, target: asked.target, reply: asked.reply });
}
