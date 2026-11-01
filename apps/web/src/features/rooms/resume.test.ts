import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  mayResumeTab,
  resumeOwnershipStaleMs,
  resumeRoundHrefOf,
} from './resume';

setupRitewayBun();

const liveRoom = {
  phase: 'live' as const,
  href: '/rounds/' + 'r'.repeat(24) + '/room',
};
const readyRoom = { phase: 'ready' as const, href: '/rooms/' + 'o'.repeat(24) };

test('resume takes the signed live href only for a member who has not left it this session', () => {
  assert({
    given:
      'a live Round for a member, the same with an explicit departure this session, and a non-debater',
    should:
      "resume only the fresh member's live Round; never a departed, signed-out or terminal case",
    actual: [
      resumeRoundHrefOf({ actorId: 'me', room: liveRoom, departed: false }),
      resumeRoundHrefOf({ actorId: 'me', room: liveRoom, departed: true }),
      resumeRoundHrefOf({ actorId: null, room: liveRoom, departed: false }),
    ],
    expected: [liveRoom.href, null, null],
  });
});

test('no Round, an assembling or ready Room, and no live phase never resume', () => {
  assert({
    given: 'a created Room still assembling, one ready, and no Room at all',
    should: 'keep the viewer where they are: only a launched Round resumes',
    actual: [
      resumeRoundHrefOf({ actorId: 'me', room: null, departed: false }),
      resumeRoundHrefOf({ actorId: 'me', room: readyRoom, departed: false }),
    ],
    expected: [null, null],
  });
});

test('tab ownership yields to a fresh claim from another tab and takes over a stale one after its window', () => {
  const now = 1000;
  const fresh: {
    mine: { owner: string; claimedAtMs: number };
    theirs: { owner: string; claimedAtMs: number };
  } = {
    mine: { owner: 'ski', claimedAtMs: now },
    theirs: { owner: 'theirs', claimedAtMs: now },
  };
  assert({
    given:
      "own fresh ownership, another tab's fresh ownership, a stale claim, and a claim made just after the stale grace",
    should:
      'resume my work, defer to the fresh owner, then take over one exactly after its own resume window',
    actual: [
      mayResumeTab('ski', fresh.mine, now),
      mayResumeTab('ski', fresh.theirs, now),
      mayResumeTab(
        'ski',
        { owner: 'gone', claimedAtMs: now - resumeOwnershipStaleMs },
        now,
      ),
      mayResumeTab(
        'ski',
        { owner: 'gone', claimedAtMs: now - resumeOwnershipStaleMs - 1 },
        now,
      ),
    ],
    expected: ['resume', 'defer', 'take-over', 'take-over'],
  });
});
