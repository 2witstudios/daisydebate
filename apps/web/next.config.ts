import type { NextConfig } from 'next';
// Sentry 11 moved the build wrapper to a subpath export (the runtime SDK
// stays on the root entry, where the adapters import it).
import { withSentryConfig } from '@sentry/nextjs/config';
import { roundMediaPages } from './src/features/round-media/browser-policy';
const config: NextConfig = {
  poweredByHeader: false,
  typescript: {
    // Only the Docker image build skips Next's own TypeScript pass
    // (ISSUE-527, apps/web/Dockerfile): CI's typecheck gates every deployed
    // commit, and `bun run build` and `bun check` still typecheck here.
    ignoreBuildErrors: process.env.DAISY_IMAGE_BUILD === '1',
  },
  // The repo forbids a second agent doc (root AGENTS.md); stop `next dev` generating them.
  agentRules: false,
  serverExternalPackages: [
    '@daisy/db',
    '@daisy/redis',
    '@daisy/logger',
    '@daisy/observability',
    '@daisy/config',
  ],
  experimental: {
    serverActions: {
      // Form actions carry a few short fields (the username claim's own
      // route reads at most 4 KiB). Next reads and decodes the whole body
      // before an action's session and rate-limit gates run, so anything
      // larger is refused unread instead of at the 1 MB default (ISSUE-79).
      bodySizeLimit: '16kb',
    },
  },
  transpilePackages: [
    '@daisy/ai-voice',
    '@daisy/debate-engine',
    '@daisy/protocol',
    '@daisy/errors',
    '@daisy/auth',
  ],
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/icon' }];
  },
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
      // Local room checks need self camera/microphone. All other routes deny
      // capture; this grants neither publication nor server readiness.
      ...roundMediaPages.map((source) => ({
        source,
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=()',
          },
        ],
      })),
    ];
  },
};
// ADR 0037: build-time behavior is source-map upload only. It happens when,
// and only when, a deploy-time `SENTRY_AUTH_TOKEN` exists (the plugin reads
// it from the environment itself); a keyless build stays green and uploads
// nothing. The slugs name the projects inside the token's org.
export default withSentryConfig(config, {
  org: '2witstudios',
  project: 'daisy-web',
  sourcemaps: {
    // Upload only when a deploy-time token exists; a keyless build stays
    // green and uploads nothing.
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
