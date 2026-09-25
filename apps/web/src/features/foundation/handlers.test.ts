import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createProofHandlers } from './handlers';

setupRitewayBun();

const dependencies = {
  origin: 'http://localhost:3000',
  logger: silentLogger,
  enabled: true,
  database: {
    getFormat: async () => null,
    createDebate: async (): Promise<never> => {
      throw new Error('unreachable: refused before any durable work');
    },
    getDebate: async () => null,
  },
  clock: fixedClock('2026-01-01T00:00:00.000Z'),
  ids: { next: () => 'd5e8f2a4c6b1k3m7n9p2r4t6' },
};

describe('POST /api/foundation/proof origin gate', () => {
  test('refuses Origin: null even with Sec-Fetch-Site: same-origin', async () => {
    const { POST } = createProofHandlers(dependencies);
    const response = await POST(
      new Request('http://localhost:3000/api/foundation/proof', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'null',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ resolution: 'This house' }),
      }),
    );
    assert({
      given:
        'a proof-debate creation posted with the opaque form origin carve-out headers, not a fetch from this origin',
      should: 'refuse with 403 AUTHORIZATION',
      actual: [
        response.status,
        ((await response.json()) as { error: { code: string } }).error.code,
      ],
      expected: [403, 'AUTHORIZATION'],
    });
  });
});
