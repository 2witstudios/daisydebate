import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retentionTargets } from './retention-sweep';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';

setupRitewayBun();

type Targets = Parameters<typeof retentionTargets>[0];

test('no retention target deletes messaging rows by age (DEC-126, DEC-251)', () => {
  const asked: string[] = [];
  // Every purge the sweep may be handed, recorded by name and never run.
  const database = new Proxy(
    {},
    {
      get: (_target, name) => {
        asked.push(String(name));
        return async () => 0;
      },
    },
  ) as Targets['database'];
  const targets = retentionTargets({
    database,
    redis: { sweepOnlinePresence: async () => 0 },
    provisionalLinks: provisionalLinkPurposes,
  });
  assert({
    given: 'the production retention targets',
    should:
      'name no messaging table and ask for no messaging purge: messages live until their author deletes them or is erased',
    actual: [
      targets.filter(({ name }) => /messag|channel|reaction/i.test(name)),
      asked.filter((name) => /messag|channel|reaction/i.test(name)),
    ],
    expected: [[], []],
  });
});
