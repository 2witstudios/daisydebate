import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRoundReply } from '../apps/web/e2e/support/round-read-reply';
setupRitewayBun();
for (const advice of ['1', undefined, 'invalid'] as const)
  test(`round proof read honors only supported temporary advice=${advice}`, async () => {
    let reads = 0;
    const waits: number[] = [];
    const reply = await readRoundReply(
      async () => {
        reads++;
        const status = reads === 1 ? 503 : 200;
        const headers: Record<string, string> = {};
        if (advice !== undefined) headers['retry-after'] = advice;
        return { status: () => status, headers: () => headers };
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    const temporary = advice === '1';
    assert({
      given: `503 with ${advice} advice before a hypothetical200`,
      should:
        'retry only the explicitly supported temporary refusal, never hide an unadvertised failure',
      actual: { status: reply.status(), reads, waits },
      expected: temporary
        ? { status: 200, reads: 2, waits: [2000] }
        : { status: 503, reads: 1, waits: [] },
    });
  });
test('persistent temporary refusal exhausts the existing finite read budget', async () => {
  let reads = 0;
  const waits: number[] = [];
  const reply = await readRoundReply(
    async () => {
      reads++;
      return { status: () => 503, headers: () => ({ 'retry-after': '1' }) };
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert({
    given: 'advertised temporary503 which never recovers',
    should:
      'return the real refusal after at most5retries and10seconds of scheduled wait, without inventing a successful read',
    actual: {
      status: reply.status(),
      reads,
      waits: waits.length,
      waitMs: waits.reduce((a, b) => a + b, 0),
    },
    expected: { status: 503, reads: 6, waits: 5, waitMs: 10000 },
  });
});
