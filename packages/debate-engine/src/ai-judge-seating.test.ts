import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomCommand } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

const room = (competitionType: 'casual' | 'ranked') => {
  const base = state();
  return {
    ...base,
    competitionType,
    rules: { ...base.rules, seats: { ...base.rules.seats, judge: 1 } },
  };
};
const seat = {
  id: 'candidate',
  label: 'Daisy',
  role: 'judge' as const,
  slot: 0,
  consentVersion: 0,
  consentCommandId: null,
};
const aiJudge = {
  ...seat,
  actorId: 'ai-judge',
  kind: 'bot' as const,
  eligible: true,
  seatRole: 'judge' as const,
};
const humanJudge = {
  ...seat,
  actorId: 'host',
  kind: 'human' as const,
  eligible: true,
  seatRole: null,
};
const assign = (
  actorId: string,
  version: number,
): Extract<RoomCommand, { type: 'assign-seat' }> => ({
  type: 'assign-seat',
  commandId: 'assign',
  expectedVersion: version,
  actorId,
  role: 'judge',
  slot: 0,
});
const refusal = (
  outcome: ReturnType<typeof executeRoomCommand>,
): string | null => (outcome.ok ? null : outcome.refusal);

test('seating the AI judge is premium on casual Rounds and free on ranked Rounds', () => {
  const seating = (
    competitionType: 'casual' | 'ranked',
    target: typeof aiJudge | typeof humanJudge,
    hostMaySeatCasualAiJudge: boolean,
  ) => {
    const start = room(competitionType);
    return refusal(
      executeRoomCommand(
        start,
        'host',
        assign(target.actorId, start.version),
        consent,
        { ...edges, target, hostMaySeatCasualAiJudge },
      ),
    );
  };
  assert({
    given: 'a casual Room whose host lacks the entitlement',
    should: 'refuse the AI judge seat with its own refusal',
    actual: seating('casual', aiJudge, false),
    expected: 'ai-judge-premium',
  });
  assert({
    given: 'a casual Room whose host holds the entitlement',
    should: 'seat the AI judge',
    actual: seating('casual', aiJudge, true),
    expected: null,
  });
  assert({
    given: 'a ranked Room whose host lacks the entitlement',
    should: 'seat the AI judge free',
    actual: seating('ranked', aiJudge, false),
    expected: null,
  });
  assert({
    given: 'a casual Room whose host lacks the entitlement',
    should: 'still seat a human judge',
    actual: seating('casual', humanJudge, false),
    expected: null,
  });
});

test('Launch rechecks the AI judge seat against the host entitlement', () => {
  const seated = (competitionType: 'casual' | 'ranked') => {
    const start = room(competitionType);
    const outcome = executeRoomCommand(
      start,
      'host',
      assign(aiJudge.actorId, start.version),
      consent,
      { ...edges, target: aiJudge, hostMaySeatCasualAiJudge: true },
    );
    if (!outcome.ok) throw new Error(outcome.refusal);
    return outcome.mutation.state;
  };
  const launch = (
    competitionType: 'casual' | 'ranked',
    hostMaySeatCasualAiJudge: boolean,
  ) => {
    const ready = seated(competitionType);
    return refusal(
      executeRoomCommand(
        ready,
        'host',
        {
          type: 'start-round',
          commandId: 'start',
          expectedVersion: ready.version,
        },
        consent,
        { ...edges, hostMaySeatCasualAiJudge },
      ),
    );
  };
  assert({
    given: 'a casual AI judge seat whose host has since lost the entitlement',
    should: 'refuse the Launch with the same refusal',
    actual: launch('casual', false),
    expected: 'ai-judge-premium',
  });
  assert({
    given: 'a casual AI judge seat whose host still holds the entitlement',
    should: 'launch',
    actual: launch('casual', true),
    expected: null,
  });
  assert({
    given: 'a ranked AI judge seat whose host holds no entitlement',
    should: 'launch',
    actual: launch('ranked', false),
    expected: null,
  });
});
