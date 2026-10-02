import { describe, disabled, disabledResponse, json, siteOrigin } from '@/lib/oai/service';

/**
 * OSIRIS OAI — what the service offers: providers, depths, limits, endpoints.
 * GET /api/oai
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (disabled()) return disabledResponse();
  return json(describe(siteOrigin(req)));
}
