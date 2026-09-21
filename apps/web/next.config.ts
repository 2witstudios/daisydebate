import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // The repo forbids a second agent doc (root AGENTS.md); stop `next dev` generating them.
  agentRules: false,
  serverExternalPackages: [
    '@daisy/db',
    '@daisy/redis',
    '@daisy/logger',
    '@daisy/observability',
    '@daisy/config',
  ],
  transpilePackages: [
    '@daisy/debate-engine',
    '@daisy/protocol',
    '@daisy/errors',
    '@daisy/auth',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
      // Later entries win: a URL that carries a sign-in token must never be
      // sent as a Referer (ADR 0025).
      {
        source: '/auth/confirm',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};
export default config;
