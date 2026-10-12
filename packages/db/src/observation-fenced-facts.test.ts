import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observationFactsWereFenced,
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
