import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import { account, at, deps, record, youthRound } from './fixture.test-support';
import { requestParticipantRemoval } from './removal';

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

  test('takes a Youth Round’s ranked Recording down for a youth debater or linked adult', async () => {
    const youth = (viewer: RecordingViewer) => {
      const d = deps(
        record({
          class: 'ranked',
          eligibility: { kind: 'ranked', youth: true },
        }),
        { round: youthRound },
      );
      return remove(d, viewer).then((result) => result.lifecycle.status);
    };
    assert({
      given: 'a youth debater, their coach and the other debater’s parent',
      should: 'take the whole Recording down for each',
      actual: await Promise.all(
        [account('neg'), account('coach'), account('parent')].map(youth),
      ),
      expected: ['removing', 'removing', 'removing'],
    });
    await assertRejects({
      given: 'the judge of a Youth Round',
      should: 'refuse: only the debaters and their adults take it down',
      actual: () =>
        remove(
          deps(
            record({
              class: 'ranked',
              eligibility: { kind: 'ranked', youth: true },
            }),
            { round: youthRound },
          ),
          account('judge'),
        ),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a stranger on a Youth Round',
      should: 'refuse',
      actual: () =>
        remove(
          deps(
            record({
              class: 'ranked',
              eligibility: { kind: 'ranked', youth: true },
            }),
            { round: youthRound },
          ),
          account('stranger'),
        ),
      code: 'AUTHORIZATION',
    });
  });
});
