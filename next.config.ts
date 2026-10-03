import type { NextConfig } from "next";

/**
 * Origens confiáveis que podem:
 *  - consumir a API OSIRIS via fetch (CORS)
 *  - embedar a aplicação OSIRIS em iframe (frame-ancestors)
 *
 * Mantenha atualizada quando adicionar novos domínios de front-end.
 */
const ALLOWED_ORIGINS = [
  "https://centrodesobrevivencia.vercel.app",
  "https://centrodesobrevivencia.app",
  "https://centrodesobrevivencia-lovable.vercel.app",
  // Preview branches da Vercel (centrodesobrevivencia-*-clodoaldo608-*.vercel.app)
  // — cobertura broad via regex abaixo; mantemos também os literais.
  "http://localhost:8080",
  "http://localhost:4173",
  "http://localhost:3000",
];

function corsFor(origin: string | undefined): string | null {
  if (!origin) return null;
  const isAllowed =
    ALLOWED_ORIGINS.includes(origin) ||
    // preview branches da Vercel do Centro de Sobrevivência
    /^https:\/\/centrodesobrevivencia-[a-z0-9]+-clodoaldo608-gmailcoms-projects\.vercel\.app$/.test(origin) ||
    // preview branches da Vercel do próprio OSIRIS (para dev)
    /^https:\/\/osiris-[a-z0-9]+-clodoaldo608-gmailcoms-projects\.vercel\.app$/.test(origin);
  return isAllowed ? origin : null;
}

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      'maplibre-gl.mjs': {
        loaders: [`${__dirname}/tools/maplibre-url-loader.cjs`],
        as: '*.js',
      },
    },
  },
  /* Standalone output exists for the Docker image — the Dockerfile copies
     .next/standalone. Vercel builds its own artifacts and does not want it:
     since the 16.2.6 -> 16.3.4 bump its adapter fails packaging with
     `ENOENT .next/next-server.js.nft.json` in onBuildComplete when a
     Turbopack build also emits standalone. The build itself compiles fine,
     which is why this only ever shows up on a deploy. Keep standalone
     everywhere except Vercel, so Docker and the platform both get what they
     expect. */
  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['ws'],
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    const allowedFrameAncestors = ALLOWED_ORIGINS.join(" ");
    return [
      // Worker do MapLibre — imutável
      {
        source: '/vendor/maplibre/:version/:file*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Páginas HTML — permitir iframe no Centro de Sobrevivência
      // CORS da API é injetado dinamicamente pelo middleware (src/middleware.ts)
      // porque a spec CORS exige que Access-Control-Allow-Origin seja UMA origem
      // ou "*", nunca uma lista separada por vírgulas.
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: `default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:; frame-ancestors 'self' ${allowedFrameAncestors};` },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
