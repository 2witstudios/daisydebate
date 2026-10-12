import { assert, setupRitewayBun, test } from 'riteway/bun';
import { reconcileRoomParticipants } from './room-participant-reconciliation';
setupRitewayBun();
const seats = [
  {
    id: 'a'.repeat(24),
    actorId: 'b'.repeat(24),
    role: 'affirmative' as const,
    slot: 0,
    kind: 'human' as const,
    label: 'Member',
    eligible: true,
    consentCommandId: null,
    consentVersion: 1,
  },
];
test('content-only Room writes preserve participant rows and readiness changes remain separate from audience', () => {
  const same = reconcileRoomParticipants(
    seats,
    seats.map((p) => ({ ...p })),
  );
  const readiness = reconcileRoomParticipants(
    seats,
    seats.map((p) => ({
      ...p,
      consentCommandId: 'c'.repeat(24),
      consentVersion: 2,
    })),
  );
  assert({
    given: 'identical audience and a separate readiness-only change',
    should: 'avoid delete/reinsert churn and isolate readiness updates',
    actual: {
      same,
      remove: readiness.removeIds,
      insert: readiness.insertSeats,
      readiness: readiness.updatedSeats.length,
    },
    expected: {
      same: { removeIds: [], insertSeats: [], updatedSeats: [] },
      remove: [],
      insert: [],
      readiness: 1,
    },
  });
});
test('actual audience change removes old association before inserting the new association', () => {
  const next = seats.map((p) => ({ ...p, actorId: 'd'.repeat(24) }));
  const delta = reconcileRoomParticipants(seats, next);
  assert({
    given: 'an actual changed seat actor',
    should: 'replace only the changed association in fixed child order',
    actual: delta,
    expected: {
      removeIds: [seats[0]!.id],
      insertSeats: next,
      updatedSeats: [],
    },
  });
});
test('moving an existing actor to a vacant seat updates its row without membership churn', () => {
  const next = seats.map((p) => ({ ...p, role: 'negative' as const }));
  const delta = reconcileRoomParticipants(seats, next);
  assert({
    given: 'the same actor moves into a vacant role/slot',
    should:
      'retain its association and update display/readiness fields in place',
    actual: delta,
    expected: { removeIds: [], insertSeats: [], updatedSeats: next },
  });
});
