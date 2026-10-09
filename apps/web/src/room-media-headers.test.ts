import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import config from '../next.config';
setupRitewayBun();
describe('local room media Permissions-Policy', () => {
  test('overrides only canonical room detail and keeps other security headers', async () => {
    const rules = await config.headers!();
    const policies = rules.flatMap((rule) =>
      rule.headers
        .filter((header) => header.key === 'Permissions-Policy')
        .map((header) => ({ source: rule.source, value: header.value })),
    );
    assert({
      given: 'production header declarations',
      should: 'deny by default then allow only room detail self',
      actual: policies,
      expected: [
        {
          source: '/:path*',
          value: 'camera=(), microphone=(), geolocation=()',
        },
        {
          source: '/rooms/:id',
          value: 'camera=(self), microphone=(self), geolocation=()',
        },
      ],
    });
    assert({
      given: 'room exception',
      should: 'retain global security headers',
      actual: rules[0]!.headers
        .filter((h) =>
          [
            'X-Content-Type-Options',
            'Referrer-Policy',
            'X-Frame-Options',
          ].includes(h.key),
        )
        .map((h) => [h.key, h.value]),
      expected: [
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        ['X-Frame-Options', 'DENY'],
      ],
    });
  });
});
