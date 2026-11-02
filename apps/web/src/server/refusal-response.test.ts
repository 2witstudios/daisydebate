import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, createRefusal } from '@daisy/errors';
import { roundRefusalSchema } from '@daisy/protocol';
import { refusalResponse } from './http';

setupRitewayBun();

const REQUEST_ID = 'r'.repeat(24);

test('a route answers a refusal by its reason, whatever its message says (ISSUE-1010)', async () => {
  const answered = refusalResponse(
    createRefusal('CONFLICT', 'attendance-unsettled', 'Any reworded sentence'),
    REQUEST_ID,
    roundRefusalSchema.options,
  );
  assert({
    given: 'a reworded refusal in the route vocabulary',
    should: 'answer its status and word, keeping the public message fixed',
    actual: [answered?.status, await answered?.json()].map((part) =>
      typeof part === 'object' ? [part.refusal, part.error.message] : part,
    ),
    expected: [409, ['attendance-unsettled', 'Resource conflict']],
  });
  const word: string = 'attendance-unsettled';
  assert({
    given: "the same word as a message, and a reason outside the route's words",
    should: 'answer nothing, so the caller treats it as any other error',
    actual: [
      refusalResponse(
        createAppError('CONFLICT', word),
        REQUEST_ID,
        roundRefusalSchema.options,
      ),
      refusalResponse(
        createRefusal('CONFLICT', 'active-room'),
        REQUEST_ID,
        roundRefusalSchema.options,
      ),
    ],
    expected: [null, null],
  });
});
