import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  claimOwnership,
  heartbeatOwnership,
  mayResumeTab,
  markResumedOnce,
  resumedInThisTab,
  resumedOnceKey,
  tabIdOf,
  readOwnership,
  releaseOwnership,
  resumeOwnershipKey,
  resumeOwnershipStaleMs,
} from './resume-ownership';

setupRitewayBun();

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(item: string): void {
    this.entries.delete(item);
  }
  setItem(item: string, value: string): void {
    this.entries.set(item, value);
  }
  getItem(item: string): string | null {
    return this.entries.get(item) ?? null;
  }
}

const actor = 'actor-a';
const round = 'round-1';

test('an unowned, foreign-fresh and stale claim resolve to take-over, defer and take-over', () => {
  const now = 10_000;
  assert({
    given:
      'no claim, a fresh foreign claim, my own fresh claim, and a claim past the grace',
    should:
      'take over when nothing fresh stands, defer only to a fresh foreign owner, and resume on my own claim',
    actual: [
      mayResumeTab('ski', { owner: null, claimedAtMs: null }, now),
      mayResumeTab('ski', { owner: 'theirs', claimedAtMs: now }, now),
      mayResumeTab('ski', { owner: 'ski', claimedAtMs: now }, now),
      mayResumeTab(
        'ski',
        { owner: 'gone', claimedAtMs: now - resumeOwnershipStaleMs },
        now,
      ),
    ],
    expected: ['take-over', 'defer', 'resume', 'take-over'],
  });
});

test('a stored claim reads back validated, and garbage reads as unowned', () => {
  const storage = new MemoryStorage();
  claimOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'ski',
    nowMs: 5_000,
  });
  const held = readOwnership(storage, actor, round);
  storage.setItem(resumeOwnershipKey(actor, round), '{not json');
  const garbage = readOwnership(storage, actor, round);
  storage.setItem(resumeOwnershipKey(actor, round), '{"owner":5}');
  const wrongShape = readOwnership(storage, actor, round);
  assert({
    given: 'a written claim, unparseable bytes, and a wrong-shaped record',
    should:
      'read the written owner back whole and treat every malformed record as unowned',
    actual: [held, garbage, wrongShape],
    expected: [
      { owner: 'ski', claimedAtMs: 5_000 },
      { owner: null, claimedAtMs: null },
      { owner: null, claimedAtMs: null },
    ],
  });
});

test('a heartbeat refreshes only its own claim and never displaces another tab', () => {
  const storage = new MemoryStorage();
  claimOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'ski',
    nowMs: 5_000,
  });
  heartbeatOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'ski',
    nowMs: 7_000,
  });
  const refreshedMine = readOwnership(storage, actor, round);
  claimOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'theirs',
    nowMs: 8_000,
  });
  heartbeatOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'ski',
    nowMs: 9_000,
  });
  const afterForeignHeartbeat = readOwnership(storage, actor, round);
  assert({
    given: 'my claim, my heartbeat, a takeover, then my heartbeat again',
    should:
      'refresh my own claim and leave the foreign owner’s claim untouched',
    actual: [refreshedMine, afterForeignHeartbeat],
    expected: [
      { owner: 'ski', claimedAtMs: 7_000 },
      { owner: 'theirs', claimedAtMs: 8_000 },
    ],
  });
});

test('release steps down only its own claim', () => {
  const storage = new MemoryStorage();
  claimOwnership({
    storage,
    actorId: actor,
    roundId: round,
    tabId: 'ski',
    nowMs: 5_000,
  });
  releaseOwnership({ storage, actorId: actor, roundId: round, tabId: 'other' });
  const foreignStillHeld = readOwnership(storage, actor, round);
  releaseOwnership({ storage, actorId: actor, roundId: round, tabId: 'ski' });
  assert({
    given: 'my claim released first by another tab, then by me',
    should:
      'ignore the foreign release and remove the claim when its owner asks',
    actual: [foreignStillHeld, readOwnership(storage, actor, round)],
    expected: [
      { owner: 'ski', claimedAtMs: 5_000 },
      { owner: null, claimedAtMs: null },
    ],
  });
});

test('a future-dated advisory record cannot defer recovery indefinitely', () => {
  assert({
    given: 'an untrusted ownership timestamp ahead of the current clock',
    should: 'allow bounded recovery rather than defer until the forged future',
    actual: mayResumeTab(
      'mine',
      { owner: 'foreign', claimedAtMs: 1_000_000 },
      10_000,
    ),
    expected: 'take-over',
  });
});

test('one tab identity survives reuse and the once-marker stops a resume loop', () => {
  const session = new MemoryStorage();
  const first = tabIdOf(session, () => 'random-1');
  const second = tabIdOf(session, () => 'random-2');
  markResumedOnce(session, actor, round);
  assert({
    given:
      'the same tab asking its identity twice, and a resume recorded in it',
    should:
      'keep one stable tab identity and answer the once-marker true while another round stays false',
    actual: [
      first,
      second,
      resumedInThisTab(session, actor, round),
      resumedInThisTab(session, actor, 'round-2'),
      session.getItem(resumedOnceKey(actor, round)),
    ],
    expected: ['random-1', 'random-1', true, false, '1'],
  });
});
