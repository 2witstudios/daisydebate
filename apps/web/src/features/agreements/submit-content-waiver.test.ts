import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../rooms/assembly.test-support';
import {
  contentWaiverAnswer,
  submitContentWaiver,
} from './submit-content-waiver';
import { destinationOf, moved } from '../forms/form-state';
import { roomFormFields } from '../rooms/command-answer';

setupRitewayBun();

const form = () => {
  const data = new FormData();
  data.set('version', 'draft-1');
  data.set('accepted', 'yes');
  return data;
};
const answering =
  (status: number, body: unknown = {}) =>
  async () =>
    Response.json(body, { status });
const move = moved;

describe('submitting the content waiver', () => {
  test('what the handler answered', async () => {
    assert({
      given: 'signed, refused, a server fault and a lost connection',
      should: 'name each one',
      actual: await Promise.all([
        submitContentWaiver(answering(200, { signed: true }), form()),
        submitContentWaiver(answering(409), form()),
        submitContentWaiver(answering(500), form()),
        submitContentWaiver(async () => {
          throw new Error('lost');
        }, form()),
      ]),
      expected: ['signed', 'refused', 'unavailable', 'unavailable'],
    });
  });

  test('a native post returns to the room', () => {
    const edge = { hydrated: false, view: null, move };
    assert({
      given: 'a signature, a refusal and a lost answer, with no script',
      should:
        'move to the room, with the notice of a refusal or of an unknown outcome',
      actual: (['signed', 'refused', 'unavailable'] as const).map((result) =>
        destinationOf(contentWaiverAnswer(result, 'room', form(), edge)),
      ),
      expected: [
        '/rooms/room#',
        '/rooms/room?notice=command-refused&reason=content-waiver-required#',
        '/rooms/room?notice=command-unacknowledged#',
      ],
    });
  });

  test('a hydrated page adopts the room it unblocked', () => {
    const edge = { hydrated: true, view: assemblySnapshot as never, move };
    assert({
      given: 'a signature on a hydrated page',
      should: 'answer with the fresh view and no navigation',
      actual: contentWaiverAnswer('signed', 'room', form(), edge),
      expected: { kind: 'accepted', view: assemblySnapshot as never },
    });
    assert({
      given: 'a refusal on a hydrated page',
      should: 'keep the form with a fixed error',
      actual: roomFormFields(
        contentWaiverAnswer('refused', 'room', form(), edge),
      ).error,
      expected: 'The waiver was not signed. Review it and try again.',
    });
    assert({
      given: 'a signature whose answer was lost, on a hydrated page',
      should:
        'say nothing was refused: keep the posted waiver for a retry, which signs the same thing',
      actual: contentWaiverAnswer('unavailable', 'room', form(), edge),
      expected: {
        kind: 'unacknowledged',
        values: { version: 'draft-1', accepted: 'yes' },
      },
    });
    assert({
      given: 'a signature with no room to adopt',
      should: 'answer that it is done',
      actual: contentWaiverAnswer('signed', 'room', form(), {
        ...edge,
        view: null,
      }),
      expected: { kind: 'done' },
    });
  });
});
