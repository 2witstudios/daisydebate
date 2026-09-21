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
    ];
  },
};
export default config;
