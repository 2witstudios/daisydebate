import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sameSeat, type SeatRef } from '@daisy/protocol/seats';
import { roomBotAdmission } from './bot-admission';
import { state, caller } from './operations.test-support';
setupRitewayBun();
const withBot = (seat: SeatRef) => ({
  ...state,
  participants: [
    ...state.participants.filter((p) => !sameSeat(p.seat, seat)),
    {
      ...state.participants[0]!,
      id: 'b'.repeat(24),
      actorId: 'c'.repeat(24),
      kind: 'bot' as const,
      seat,
    },
  ],
});
const botRoom = withBot({ kind: 'side', side: 'negative', slot: 0 });
const status = { refusal: null };
const released = async () => true;
test('bot admission metadata is private to the current sponsoring human host', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return status;
  };
  const visible = await roomBotAdmission(
    botRoom,
    caller.actorId,
    read,
    released,
  );
  const hidden = await roomBotAdmission(botRoom, 'other', read, released);
  const humanOnly = await roomBotAdmission(
    state,
    caller.actorId,
    read,
    released,
  );
  const ranked = await roomBotAdmission(
    { ...botRoom, competitionType: 'ranked' },
    caller.actorId,
    read,
    released,
  );
  const judgeOnly = await roomBotAdmission(
    withBot({ kind: 'judge', slot: 0 }),
    caller.actorId,
    read,
    released,
  );
  assert({
    given:
      'host, unrelated viewer, human-only, ranked and AI-judge-only projections',
    should:
      'read and reveal allowance only to the host of a bot-debater cast, and leave judge entitlement display to its own projection',
    actual: [visible, hidden, humanOnly, ranked, judgeOnly, reads],
    expected: [{ kind: 'allowance', ...status }, null, null, null, null, 1],
  });
});
test('absent configuration and failed fresh reads are unavailable rather than inferred free', async () => {
  const absent = await roomBotAdmission(
    botRoom,
    caller.actorId,
    async () => null,
    released,
  );
  const failed = await roomBotAdmission(
    botRoom,
    caller.actorId,
    async () => {
      throw new Error('Unavailable');
    },
    released,
  );
  assert({
    given: 'absent config or an unavailable adapter',
    should: 'truthfully refuse availability without inventing quota',
    actual: [absent, failed],
    expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
  });
});
test('unreleased bot debates are coming soon before any allowance is read', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return status;
  };
  const unreleased = async () => false;
  const host = await roomBotAdmission(
    botRoom,
    caller.actorId,
    read,
    unreleased,
  );
  const judgeOnly = await roomBotAdmission(
    withBot({ kind: 'judge', slot: 0 }),
    caller.actorId,
    read,
    unreleased,
  );
  assert({
    given:
      'a host whose bot-debates flag is off, with a bot debater and with only an AI judge',
    should:
      'say coming soon for the bot debate without reading allowance, and leave the AI judge alone',
    actual: [host, judgeOnly, reads],
    expected: [{ kind: 'coming-soon' }, null, 0],
  });
});
