import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomBotAdmission } from './bot-admission';
import { state, caller } from './operations.test-support';
setupRitewayBun();
const botRoom = {
  ...state,
  participants: [
    ...state.participants,
    {
      ...state.participants[0]!,
      id: 'b'.repeat(24),
      actorId: 'c'.repeat(24),
      kind: 'bot' as const,
      role: 'judge' as const,
    },
  ],
};
const status = {
  limit: 1 as const,
  remaining: 1,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  refusal: null,
};
test('bot admission metadata is private to the current sponsoring human host', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return status;
  };
  const visible = await roomBotAdmission(botRoom, caller.actorId, read);
  const hidden = await roomBotAdmission(botRoom, 'other', read);
  const humanOnly = await roomBotAdmission(state, caller.actorId, read);
  const ranked = await roomBotAdmission(
    { ...botRoom, competitionType: 'ranked' },
    caller.actorId,
    read,
  );
  assert({
    given: 'host, unrelated viewer, human-only and ranked projections',
    should: 'read and reveal allowance only to the applicable current host',
    actual: [visible, hidden, humanOnly, ranked, reads],
    expected: [{ kind: 'allowance', ...status }, null, null, null, 1],
  });
});
test('absent configuration and failed fresh reads are unavailable rather than inferred free', async () => {
  const absent = await roomBotAdmission(
    botRoom,
    caller.actorId,
    async () => null,
  );
  const failed = await roomBotAdmission(botRoom, caller.actorId, async () => {
    throw new Error('Unavailable');
  });
  assert({
    given: 'absent config or an unavailable adapter',
    should: 'truthfully refuse availability without inventing quota',
    actual: [absent, failed],
    expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
  });
});
