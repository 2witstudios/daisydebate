import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observationFactsWereFenced,
  observationFenceStale,
  sameObservationFactSet,
} from './observation-fenced-facts';
import type { ObservationAuthorityContext } from './observation-contracts';
setupRitewayBun();
const fact: ObservationAuthorityContext['resourceFact'] = {
  kind: 'room',
  roomId: 'r'.repeat(24),
  hostActorId: 'a'.repeat(24),
  visibility: 'public',
  status: 'assembling',
  revision: 1,
  participants: [],
};
const current = new Map([['room-actor', fact]]);
test('newly present resources cannot inherit an absent-row fence or a newer disclosure header', () => {
  assert({
    given: 'Room absent at discovery/fence and present at current reread',
    should:
      'force complete retry rather than combine public facts with an unfenced header',
    actual: [
      sameObservationFactSet(new Map(), current),
      observationFactsWereFenced(current, new Set()),
      observationFactsWereFenced(current, new Set([`room:${fact.roomId}`])),
    ],
    expected: [false, false, true],
  });
});

test('either a moved cast or an unfenced current resource alone restarts the transaction', () => {
  const fenced = new Set([`room:${fact.roomId}`]);
  const moved = new Map([
    ['room-actor', fact],
    ['round-actor', { ...fact, roomId: 'q'.repeat(24) }],
  ]);
  assert({
    given: 'unchanged fenced facts, a moved cast, and an unfenced resource',
    should: 'retry for each failure independently and only then',
    actual: [
      observationFenceStale(current, current, fenced),
      observationFenceStale(
        current,
        moved,
        new Set([...fenced, `room:${'q'.repeat(24)}`]),
      ),
      observationFenceStale(current, current, new Set()),
    ],
    expected: [false, true, true],
  });
});
