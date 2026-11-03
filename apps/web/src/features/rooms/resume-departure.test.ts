import { MemoryStorage } from '../../lib/storage.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearAccountResumeRecords,
  clearDeparture,
  hasDeparted,
  markDeparture,
  sweepDepartures,
} from './resume-departure';
import { claimOwnership, resumeOwnershipKey } from './resume-ownership';

setupRitewayBun();

test('a departure belongs to one principal and one Round in this browser', () => {
  const local = new MemoryStorage();
  markDeparture('actor-a', 'round-1', local);
  assert({
    given: 'one recorded departure',
    should: 'suppress only that principal in that Round',
    actual: [
      hasDeparted('actor-a', 'round-1', local),
      hasDeparted('actor-a', 'round-2', local),
      hasDeparted('actor-b', 'round-1', local),
      hasDeparted(null, 'round-1', local),
    ],
    expected: [true, false, false, false],
  });
});

test('disabled storage reads as no departure and never throws', () => {
  const broken = new (class extends MemoryStorage {
    override getItem(): string | null {
      throw new Error('blocked');
    }
    override setItem(): void {
      throw new Error('blocked');
    }
  })();
  markDeparture('actor-a', 'round-1', broken);
  assert({
    given: 'storage that throws',
    should: 'keep recovery available',
    actual: hasDeparted('actor-a', 'round-1', broken),
    expected: false,
  });
});

test('an account ending removes departures and advisory claims a crash left behind', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  markDeparture('actor-a', 'round-1', local);
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
      hasDeparted('actor-a', 'round-1', local),
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
      hasDeparted('a1', 'r1', storage),
      hasDeparted('a1', 'r2', storage),
    ],
    expected: [false, true],
  });
});

test('a departure a member never came back from ends after a day', () => {
  const local = new MemoryStorage();
  const day = 24 * 60 * 60 * 1000;
  markDeparture('a1', 'old', local, 1000);
  markDeparture('a1', 'recent', local, 1000 + day - 1);
  const atTheDay = [
    hasDeparted('a1', 'old', local, 1000 + day),
    hasDeparted('a1', 'recent', local, 1000 + day),
  ];
  sweepDepartures(local, 1000 + day);
  assert({
    given: 'a departure a day old and a newer one, then a sweep',
    should: 'stop honoring and then remove only the old one',
    actual: [atTheDay, local.length],
    expected: [[false, true], 1],
  });
});
