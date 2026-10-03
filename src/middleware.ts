import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

/**
 * Origens confiáveis que podem consumir a API OSIRIS via fetch (CORS) ou
 * embedar a aplicação em iframe (frame-ancestors).
 */
const ALLOWED_ORIGINS = new Set([
  "https://centrodesobrevivencia.vercel.app",
  "https://centrodesobrevivencia.app",
  "https://centrodesobrevivencia-lovable.vercel.app",
  // Manual do Sobrevivente — incorpora o globo OSIRIS na "Visão Osiris"
  "https://manual-do-sobrevivente.vercel.app",
  "http://localhost:8080",
  "http://localhost:4173",
  "http://localhost:3000",
]);

/** Padrão regex para preview branches da Vercel do Centro de Sobrevivência, do próprio OSIRIS e do Manual do Sobrevivente. */
const PREVIEW_RE = /^https:\/\/(centrodesobrevivencia|osiris|manual-do-sobrevivente)-[a-z0-9]+-clodoaldo608-gmailcoms-projects\.vercel\.app$/;

function echoOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (PREVIEW_RE.test(origin)) return origin;
  return null;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "false",
};

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const url = request.nextUrl.pathname;
  const isApi = url.startsWith("/api/");

  // ─── CORS para rotas /api/* ────────────────────────────────────────────
  // A spec CORS exige que Access-Control-Allow-Origin seja uma origem ÚNICA
  // ou "*" — não uma lista separada por vírgulas. Os navegadores rejeitam
  // a lista, então precisamos fazer echo dinâmico da Origin do request.
  if (isApi) {
    const origin = request.headers.get("origin");
    const allowedOrigin = echoOrigin(origin);

    // Handle preflight
    if (request.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      if (allowedOrigin) {
        res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      }
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.headers.set(k, v);
      }
      return res;
    }

    // Normal request: forward to handler with CORS headers appended
    const res = NextResponse.next();
    if (allowedOrigin) {
      res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.headers.set(k, v);
    }
    return res;
  }

  // ─── Analytics para páginas HTML ──────────────────────────────────────
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
  const userAgent = request.headers.get('user-agent') || 'Unknown OSIRIS Client';

  const basePayload = {
    hostname: request.nextUrl.hostname,
    language: "en-US",
    referrer: request.headers.get('referer') || "",
    screen: "1920x1080",
    title: "OSIRIS",
    url: url,
    website: process.env.UMAMI_WEBSITE_ID || "cd8f216c-fc3f-45f5-ba1a-e10309a61d18"
  };

  /* Bounded, because these are fire-and-forget analytics on the critical path.
     `umami-umami-1` only resolves inside the production compose network; on a
     developer's machine it is ENOTFOUND, and two unbounded requests per page
     view accumulated against the shared connection pool until the app's own
     API routes could not get a socket. The CCTV route would then time out
     region after region and the map came up half empty — the analytics were
     starving the thing they were measuring. */
  const pageView = fetch('http://umami-umami-1:3000/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, 'x-forwarded-for': ip },
    body: JSON.stringify({ payload: basePayload, type: "event" }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

  const ipEvent = fetch('http://umami-umami-1:3000/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, 'x-forwarded-for': ip },
    body: JSON.stringify({
      payload: { ...basePayload, name: "Network Log", data: { IP: ip } },
      type: "event"
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

  event.waitUntil(Promise.all([pageView, ipEvent]));

  return NextResponse.next();
}

/* Matcher agora inclui /api/* para que o middleware possa injetar CORS.
   Assets estáticos continuam excluídos para evitar custos de analytics. */
export const config = {
  matcher: [
    // API routes (CORS injection)
    '/api/:path*',
    // Pages (analytics) — assets excluídos
    '/((?!_next/static|_next/image|vendor|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs|js|css|json|pbf|mvt|woff|woff2|ico|txt)$).*)',
  ],
}
