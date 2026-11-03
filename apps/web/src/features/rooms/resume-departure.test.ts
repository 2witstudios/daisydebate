import { MemoryStorage } from '../../lib/storage.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearAccountResumeRecords,
  clearDeparture,
  departedInSession,
  markDeparture,
} from './resume-departure';
import { claimOwnership, resumeOwnershipKey } from './resume-ownership';

setupRitewayBun();

test('a departure belongs to one principal and one Round in this tab', () => {
  const session = new MemoryStorage();
  markDeparture('actor-a', 'round-1', session);
  assert({
    given: 'one recorded departure',
    should: 'suppress only that principal in that Round',
    actual: [
      departedInSession('actor-a', 'round-1', session),
      departedInSession('actor-a', 'round-2', session),
      departedInSession('actor-b', 'round-1', session),
      departedInSession(null, 'round-1', session),
    ],
    expected: [true, false, false, false],
  });
});

test('disabled storage reads as no departure and never throws', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  markDeparture('actor-a', 'round-1', broken);
  assert({
    given: 'storage that throws',
    should: 'keep recovery available',
    actual: departedInSession('actor-a', 'round-1', broken),
    expected: false,
  });
});

test('an account ending removes departures and advisory claims a crash left behind', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  markDeparture('actor-a', 'round-1', session);
  session.setItem('daisy:unrelated', 'keep');
  claimOwnership({
    storage: local,
    actorId: 'actor-a',
    roundId: 'round-1',
    tabId: 'dead-tab',
    nowMs: 1,
  });
  local.setItem('daisy:unrelated', 'keep');
  clearAccountResumeRecords(session, local);
  assert({
    given: 'a departure, a crashed tab claim and unrelated keys',
    should: 'erase both resume records and nothing else',
    actual: [
      departedInSession('actor-a', 'round-1', session),
      local.getItem(resumeOwnershipKey('actor-a', 'round-1')),
      session.getItem('daisy:unrelated'),
      local.getItem('daisy:unrelated'),
    ],
    expected: [false, null, 'keep', 'keep'],
  });
});

test('coming back to a Round undoes an earlier step away', () => {
  const storage = new MemoryStorage();
  markDeparture('a1', 'r1', storage);
  markDeparture('a1', 'r2', storage);
  clearDeparture('a1', 'r1', storage);
  assert({
    given: 'departures from two Rounds, then a return to the first',
    should: 'let resume work again for that Round alone',
    actual: [
      departedInSession('a1', 'r1', storage),
      departedInSession('a1', 'r2', storage),
    ],
    expected: [false, true],
  });
});
