import { describe, disabled, disabledResponse, json, siteOrigin } from '@/lib/osi/service';

/**
 * OSIRIS OSI — what the service offers: providers, depths, limits, endpoints.
 * GET /api/osi
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (disabled()) return disabledResponse();
  return json(describe(siteOrigin(req)));
}
