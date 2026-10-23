import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isCaptureClosedRefusal,
  isDefiniteRefusal,
  isOpenTimelineRefusal,
} from './worker-client';
import { localClient } from './worker-client.test-support';
setupRitewayBun();

const sealing = {
  epoch: 3,
  segmentId: 'g'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  expectedChunkCount: 0,
};
const refusedSeal = async (body: object) => {
  const f = localClient(() => Response.json(body, { status: 409 }));
  try {
    return await f.client.seal(sealing).then(
      () => 'sealed',
      (error: unknown) => [
        (error as { code: string }).code,
        isOpenTimelineRefusal(error),
      ],
    );
  } finally {
    await f.close();
  }
};

test('a seal refused for an open timeline is told apart from a definite refusal', async () => {
  assert({
    given: 'a 409 naming the open timeline, and a 409 naming nothing',
    should:
      'report both as conflicts, marking only the first as resendable (VIDEO-4.1-r1)',
    actual: [
      await refusedSeal({
        error: { code: 'CONFLICT' },
        refusal: 'timeline-open',
      }),
      await refusedSeal({ error: { code: 'CONFLICT' } }),
    ],
    expected: [
      ['CONFLICT', true],
      ['CONFLICT', false],
    ],
  });
});

test('only a 4xx refusal other than a timeout or rate limit is definite', async () => {
  const outcome = async (reply: () => Response) => {
    const f = localClient(reply);
    try {
      return await f.client.lease(15000).then(
        () => 'leased',
        (error: unknown) => isDefiniteRefusal(error),
      );
    } finally {
      await f.close();
    }
  };
  assert({
    given: 'a 409, a 403, a 408, a 429, and a 503 that outlasts every retry',
    should:
      'mark the 409 and 403 definite; a timeout, a rate limit and the exhausted 503 stay uncertain (VIDEO-4.1-r4)',
    actual: [
      await outcome(() => new Response(null, { status: 409 })),
      await outcome(() => new Response(null, { status: 403 })),
      await outcome(() => new Response(null, { status: 408 })),
      await outcome(() => new Response(null, { status: 429 })),
      await outcome(() => new Response(null, { status: 503 })),
    ],
    expected: [true, true, false, false, false],
  });
});

test('a closed capture session is told apart from other definite refusals', async () => {
  const closed = async (body: object) => {
    const f = localClient(() => Response.json(body, { status: 409 }));
    try {
      return await f.client.lease(15000).then(
        () => 'leased',
        (error: unknown) => isCaptureClosedRefusal(error),
      );
    } finally {
      await f.close();
    }
  };
  assert({
    given: 'a 409 naming a closed capture, and a 409 naming nothing',
    should:
      'mark only the first as the end of the session (ISSUE-494, ISSUE-495)',
    actual: [
      await closed({ error: { code: 'CONFLICT' }, refusal: 'capture-closed' }),
      await closed({ error: { code: 'CONFLICT' } }),
    ],
    expected: [true, false],
  });
});
