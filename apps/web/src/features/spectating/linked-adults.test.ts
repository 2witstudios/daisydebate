import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import { withLinkedAdults } from './linked-adults';

setupRitewayBun();

const caller = { actorId: 'coach' };
const linked = (asked: string[]) =>
  Object.assign(
    async (roundId: string) => {
      asked.push(roundId);
      return { linkedAdultActorIds: ['coach'] };
    },
    { peek: () => undefined },
  );

describe('withLinkedAdults', () => {
  test('only the audience refusal reads the links', async () => {
    const asked: string[] = [];
    const notFound = await rejectionOf(() =>
      withLinkedAdults(caller, 'round', linked(asked), async () => {
        // The Round is missing, or the read's own work found nothing: no refusal.
        throw createAppError('NOT_FOUND');
      }),
    );
    assert({
      given: 'a NOT_FOUND the audience decision never gave',
      should: 'stand as it was, without reading anyone’s links',
      actual: [notFound?.code, asked],
      expected: ['NOT_FOUND', []],
    });
  });

  test('a refused linked adult reads once more, with the links', async () => {
    const asked: string[] = [];
    const tried: (readonly string[] | null)[] = [];
    const answer = await withLinkedAdults(
      caller,
      'round',
      linked(asked),
      async (youth, refused) => {
        tried.push(youth?.linkedAdultActorIds ?? null);
        if (youth === null) {
          refused();
          throw createAppError('NOT_FOUND');
        }
        return 'read';
      },
    );
    assert({
      given: 'a read the audience refuses without links, and the caller linked',
      should: 'read the links once and pass on the second read',
      actual: [answer, asked, tried],
      expected: ['read', ['round'], [null, ['coach']]],
    });
  });
});
