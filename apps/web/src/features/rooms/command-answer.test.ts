import { assert, setupRitewayBun, test } from 'riteway/bun';
import { commandAnswer, commandUnavailable } from './command-answer';
import { assemblySnapshot } from './assembly.test-support';
import { answerUnavailableOnThrow } from '../../ui/form-action/form-action';

setupRitewayBun();
test('accepted Launch returns only the persisted Round destination', () => {
  const form = new FormData();
  form.set('type', 'start-round');
  const view = {
    ...assemblySnapshot,
    roundRef: { id: 'r'.repeat(24), status: 'scheduled' as const },
  };
  assert({
    given: 'a canonical accepted Launch with a persisted Round reference',
    should: 'return navigation action state through the supplied moveOn edge',
    actual: commandAnswer(
      { kind: 'accepted', view },
      view.id,
      form,
      (next) => ({ next }),
    ).next,
    expected: `/rounds/${view.roundRef.id}`,
  });
});
test('refusal and broken transport never answer as acknowledged commands', async () => {
  const form = new FormData();
  form.set('type', 'assign-seat');
  form.set('actorId', 'actor');
  const unavailable = answerUnavailableOnThrow(async () => {
    throw new Error('private transport detail');
  }, commandUnavailable);
  const state = await unavailable({ values: {} }, form);
  assert({
    given: 'a refused canonical command and a rejected hydrated action',
    should:
      'reread refusals and retain retry inputs without leaking internals or claiming success',
    actual: [
      commandAnswer(
        { kind: 'unavailable' },
        assemblySnapshot.id,
        form,
        (next) => ({ next }),
      ).next,
      state.values.actorId,
      Boolean(state.error),
      state.next,
      state.error?.includes('private'),
    ],
    expected: [
      `/rooms/${assemblySnapshot.id}?notice=command-refused`,
      'actor',
      true,
      undefined,
      false,
    ],
  });
});
