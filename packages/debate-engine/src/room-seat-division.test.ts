import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  judgeSeat,
  sideSeat,
  type RatingDivision,
  type SeatRef,
} from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

/** A Room of this lobby with the negative seat free and one judge seat. */
const roomIn = (division: RatingDivision) => {
  const base = state();
  return {
    ...base,
    division,
    competitionType: 'ranked' as const,
    rules: { ...base.rules, seats: { ...base.rules.seats, judges: 1 } },
    participants: base.participants.filter((p) => p.actorId === 'host'),
  };
};

const member = (division: RatingDivision | null, seat: SeatRef) => ({
  id: 'candidate',
  actorId: 'member',
  label: 'Member',
  kind: 'human' as const,
  seat,
  eligible: true,
  division,
  aiRole: null,
  consentVersion: 0,
  teamOpen: false,
  positionOpen: false,
  consentCommandId: null,
});

const claim = (
  division: RatingDivision,
  taker: RatingDivision | null,
  seat: SeatRef,
) => {
  const room = roomIn(division);
  const outcome = executeRoomCommand(
    room,
    'member',
    {
      type: 'claim-seat',
      commandId: 'claim',
      expectedVersion: room.version,
      seat,
    },
    consent,
    { ...edges, target: member(taker, seat) },
  );
  return outcome.ok ? 'seated' : outcome.refusal;
};

/** A seatless host moving a member who judges in their Room onto a debater seat. */
const assign = (division: RatingDivision, taker: RatingDivision) => {
  const judging = member(taker, judgeSeat());
  const base = roomIn(division);
  const room = {
    ...base,
    participants: [
      {
        id: judging.id,
        actorId: judging.actorId,
        label: judging.label,
        kind: judging.kind,
        seat: judging.seat,
        eligible: true,
        consentVersion: 0,
        teamOpen: false,
        positionOpen: false,
        consentCommandId: null,
      },
    ],
  };
  const outcome = executeRoomCommand(
    room,
    'host',
    {
      type: 'assign-seat',
      commandId: 'assign',
      expectedVersion: room.version,
      actorId: 'member',
      seat: sideSeat('negative'),
    },
    consent,
    { ...edges, target: member(taker, sideSeat('negative')) },
  );
  return outcome.ok ? 'seated' : outcome.refusal;
};

test('a debater seat is for the Room’s own lobby (ADR 0156)', () => {
  assert({
    given: 'a member claiming a debater seat in their own lobby’s Room',
    should: 'seat them',
    actual: [
      claim('open', 'open', sideSeat('negative')),
      claim('youth', 'youth', sideSeat('negative')),
    ],
    expected: ['seated', 'seated'],
  });
  assert({
    given: 'a minor claiming an Open debater seat and an adult a Youth one',
    should: 'refuse both as the other lobby’s seat',
    actual: [
      claim('open', 'youth', sideSeat('negative')),
      claim('youth', 'open', sideSeat('negative')),
    ],
    expected: ['other-division', 'other-division'],
  });
  assert({
    given: 'a seatless host moving a judge of the other lobby to a debater seat',
    should: 'refuse it as a claim is refused',
    actual: [assign('youth', 'open'), assign('open', 'youth')],
    expected: ['other-division', 'other-division'],
  });
  assert({
    given: 'anyone claiming a judge seat in either lobby',
    should: 'seat them',
    actual: [
      claim('youth', 'open', judgeSeat()),
      claim('open', 'youth', judgeSeat()),
    ],
    expected: ['seated', 'seated'],
  });
});
