import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../rooms/assembly.test-support';
import {
  contentWaiverAnswer,
  submitContentWaiver,
} from './submit-content-waiver';

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
const move = (next: string) => ({ next });

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
      given: 'a signature and a refusal, with no script',
      should: 'move to the room, with the notice when refused',
      actual: [
        contentWaiverAnswer('signed', 'room', form(), edge).next,
        contentWaiverAnswer('refused', 'room', form(), edge).next,
      ],
      expected: [
        '/rooms/room#',
        '/rooms/room?notice=command-refused&reason=content-waiver-required#',
      ],
    });
  });

  test('a hydrated page adopts the room it unblocked', () => {
    const edge = { hydrated: true, view: assemblySnapshot as never, move };
    assert({
      given: 'a signature on a hydrated page',
      should: 'answer with the fresh view and no navigation',
      actual: contentWaiverAnswer('signed', 'room', form(), edge),
      expected: { values: {}, view: assemblySnapshot as never },
    });
    assert({
      given: 'a refusal on a hydrated page',
      should: 'keep the form with a fixed error',
      actual: contentWaiverAnswer('refused', 'room', form(), edge).error,
      expected: 'The waiver was not signed. Review it and try again.',
    });
  });
});
