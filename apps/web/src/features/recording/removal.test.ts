import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import { account, at, deps, ready, record } from './fixture.test-support';
import { applyModeration, requestParticipantRemoval } from './removal';

setupRitewayBun();

describe('requestParticipantRemoval', () => {
  const remove = (
    d: ReturnType<typeof deps>,
    viewer: RecordingViewer,
    expectedVersion = 3,
  ) =>
    requestParticipantRemoval(
      { store: d.store, inputs: d.inputs },
      { recordingId: 'rec', expectedVersion, viewer, now: at },
    );

  test('removes a casual Recording whole for any participant', async () => {
    const d = deps();
    const result = await remove(d, account('neg'));
    assert({
      given: 'a participant confirming the version they saw',
      should: 'record the durable intent',
      actual: [result.lifecycle.status, result.version],
      expected: ['removing', 4],
    });
  });

  test('preserves state on every refusal', async () => {
    const ranked = deps(record({ class: 'ranked' }));
    await assertRejects({
      given: 'a debater on a ranked Recording',
      should: 'refuse',
      actual: () => remove(ranked, account('aff')),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'that refusal',
      should: 'leave the Recording ready at its version',
      actual: [
        ranked.rows.get('rec')?.lifecycle.status,
        ranked.rows.get('rec')?.version,
      ],
      expected: ['ready', 3],
    });
    await assertRejects({
      given: 'a stranger on a casual Recording',
      should: 'refuse',
      actual: () => remove(deps(), account('stranger')),
      code: 'AUTHORIZATION',
    });
    const stale = deps();
    await assertRejects({
      given: 'a form showing an old version',
      should: 'ask again',
      actual: () => remove(stale, account('aff'), 2),
      code: 'CONFLICT',
    });
    assert({
      given: 'a stale form',
      should: 'change nothing',
      actual: stale.rows.get('rec')?.lifecycle.status,
      expected: 'ready',
    });
  });
});

describe('applyModeration', () => {
  test('can take ranked down and put it back', async () => {
    const d = deps(record({ class: 'ranked' }));
    const down = await applyModeration(d.store, {
      recordingId: 'rec',
      action: 'take_down',
      expectedVersion: 3,
      now: at,
    });
    const back = await applyModeration(d.store, {
      recordingId: 'rec',
      action: 'restore',
      expectedVersion: 4,
      now: at,
    });
    assert({
      given: 'a takedown then a restore',
      should: 'hide and then restore the same media',
      actual: [down.lifecycle.status, back.lifecycle],
      expected: ['taken_down', ready],
    });
    await assertRejects({
      given: 'a stale moderation decision',
      should: 'refuse',
      actual: () =>
        applyModeration(d.store, {
          recordingId: 'rec',
          action: 'remove',
          expectedVersion: 3,
          now: at,
        }),
      code: 'CONFLICT',
    });
  });
});
