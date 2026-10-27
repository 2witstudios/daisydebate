import type { NextConfig } from 'next';

// The admin app (ADR 0077): server components and server-action forms; the
// passkey ceremony is its only client script. Served only to
// http://localhost:4800 through `fly proxy`, so no HSTS: the origin is http.
const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ['drizzle-orm', '@simplewebauthn/server'],
  transpilePackages: ['@daisy/protocol'],
  experimental: { serverActions: { bodySizeLimit: '16kb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};
export default config;
