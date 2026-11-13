import { assert, setupRitewayBun, test } from 'riteway/bun';
import { nextRoomVacancy, postRoundCallGrants } from './post-round-call';

import type { RoundMediaGrants } from './media-grants';

setupRitewayBun();

const now = '2026-10-22T12:00:00.000Z';
const earlier = '2026-10-22T11:59:00.000Z';
const occupied = {
  kind: 'read',
  sid: 'RM_call',
  empty: false,
  captureListed: false,
  answered: null,
} as const;

test('postRoundCallGrants()', () => {
  const open: RoundMediaGrants = {
    publish: ['camera', 'microphone'],
    subscribe: true,
    hidden: false,
    capture: false,
  };
  const none: RoundMediaGrants = {
    publish: [],
    subscribe: false,
    hidden: false,
    capture: false,
  };
  assert({
    given: 'an eligible human seat, a judge included',
    should: 'be seen and heard',
    actual: postRoundCallGrants({ kind: 'human', eligible: true }),
    expected: open,
  });
  assert({
    given: 'a bot, a seat that lost its place, and no seat',
    should: 'get nothing',
    actual: [
      postRoundCallGrants({ kind: 'bot', eligible: true }),
      postRoundCallGrants({ kind: 'human', eligible: false }),
      postRoundCallGrants(undefined),
    ],
    expected: [none, none, none],
  });
});

test('nextRoomVacancy()', () => {
  assert({
    given: 'a pass that read nothing',
    should: 'change nothing',
    actual: [
      nextRoomVacancy(null, null, now),
      nextRoomVacancy(earlier, null, now),
    ],
    expected: [null, earlier],
  });
  assert({
    given: 'an occupied room',
    should: 'clear the vacancy',
    actual: nextRoomVacancy(earlier, occupied, now),
    expected: null,
  });
  assert({
    given: 'an empty or absent room, first seen so now',
    should: 'start the vacancy now',
    actual: [
      nextRoomVacancy(null, { ...occupied, empty: true }, now),
      nextRoomVacancy(null, { kind: 'absent' }, now),
    ],
    expected: [now, now],
  });
  assert({
    given: 'a room already vacant',
    should: 'keep when it began',
    actual: nextRoomVacancy(earlier, { kind: 'absent' }, now),
    expected: earlier,
  });
});
