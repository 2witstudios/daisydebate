import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildUserInboxTopic,
  ENVELOPE_VERSION,
  type ChallengeList,
} from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';
import { driverEdges } from '../resource-sync/driver.test-support';
import {
  CHALLENGE_BACKSTOP_MS,
  createChallengeSyncDriver,
  OFFER_WATCH_MS,
} from './challenge-sync-driver';
import { challengeListOf, endedOffersOf } from './challenges-held';
import { listOf, offer, offerId } from './challenges-held.test-support';

setupRitewayBun();

const actorId = offerId('m');
const topic = buildUserInboxTopic(actorId);

function harness(seed: ChallengeList, { realtime = true } = {}) {
  const edges = driverEdges<ResourceRead<ChallengeList>>();
  const driver = createChallengeSyncDriver({
    seed,
    read: edges.read,
    inbox: realtime ? { actorId, connection: edges.connection } : null,
    scheduler: edges.scheduler,
    visibility: edges.visibility,
  });
  const found = async (list: ChallengeList) => {
    edges.answer({ kind: 'found', value: list });
    await edges.flush();
  };
  return {
    ...edges,
    driver,
    found,
    ring: () =>
      edges.emit({
        v: ENVELOPE_VERSION,
        type: 'event',
        topic,
        position: '1:1',
        payload: { kind: 'challenge.changed' },
      }),
    waiting: () =>
      challengeListOf(driver.readSnapshot().value).outgoing.map(
        (row) => row.id,
      ),
    ended: () => endedOffersOf(driver.readSnapshot().value),
  };
}

describe('challenge sync driver', () => {
  test('a ring on the inbox reads the list at once', async () => {
    const tab = harness(listOf([offer('a')]));
    const before = tab.reads();
    tab.ring();
    const rung = tab.reads();
    await tab.found(listOf());
    assert({
      given: 'an offer waiting, a ring, and a read that finds the offer gone',
      should:
        'subscribe to the member inbox, read once on the ring and say the offer ended',
      actual: {
        log: tab.log.slice(0, 2),
        reads: [before, rung],
        waiting: tab.waiting(),
        ended: tab.ended(),
      },
      expected: {
        log: [`subscribe ${topic}`, 'connect'],
        reads: [0, 1],
        waiting: [],
        ended: [{ id: offerId('a'), username: 'mara' }],
      },
    });
    tab.driver.dispose();
  });

  test('a ring about anything else reads nothing', () => {
    const tab = harness(listOf());
    tab.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic,
      position: '1:1',
      payload: { kind: 'messaging.inbox.changed' },
    });
    assert({
      given: 'a ring on the inbox that is not about challenges',
      should: 'not read the list',
      actual: tab.reads(),
      expected: 0,
    });
    tab.driver.dispose();
  });

  test('subscribing again reads, for a ring missed while the socket was down', () => {
    const tab = harness(listOf());
    tab.emit({
      v: ENVELOPE_VERSION,
      type: 'subscribed',
      id: 'request-1',
      topic,
      position: '1:1',
    });
    assert({
      given: 'the inbox subscription confirmed',
      should: 'read the list once',
      actual: tab.reads(),
      expected: 1,
    });
    tab.driver.dispose();
  });

  test('an open offer is checked every five seconds, because its running out rings nobody', async () => {
    const tab = harness(listOf([offer('a')]));
    tab.advance(OFFER_WATCH_MS - 1);
    const early = tab.reads();
    tab.advance(1);
    const first = tab.reads();
    await tab.found(listOf([offer('a')]));
    tab.advance(OFFER_WATCH_MS);
    const second = tab.reads();
    await tab.found(listOf([], [], ['i']));
    tab.advance(OFFER_WATCH_MS);
    const incoming = tab.reads();
    await tab.found(listOf());
    tab.advance(OFFER_WATCH_MS);
    const closed = tab.reads();
    tab.advance(CHALLENGE_BACKSTOP_MS - OFFER_WATCH_MS);
    assert({
      given:
        'an offer sent, then only an offer received, then no offer open at all',
      should:
        'read five seconds after each read while an offer is open, then only on the backstop',
      actual: {
        early,
        first,
        second,
        incoming,
        closed,
        backstop: tab.reads(),
      },
      expected: {
        early: 0,
        first: 1,
        second: 2,
        incoming: 3,
        closed: 3,
        backstop: 4,
      },
    });
    tab.driver.dispose();
  });

  test('with no offer open the list is read only on the backstop', () => {
    const tab = harness(listOf([], ['a']));
    tab.advance(CHALLENGE_BACKSTOP_MS - 1);
    const early = tab.reads();
    tab.advance(1);
    assert({
      given: 'an accepted offer, no offer open, and nothing ringing',
      should: 'read once the backstop interval has passed, not before',
      actual: [early, tab.reads()],
      expected: [0, 1],
    });
    tab.driver.dispose();
  });

  test("a refresh after the member's own action reads at once, and again after a read in flight", async () => {
    const tab = harness(listOf([offer('a')]));
    tab.driver.refresh();
    const first = tab.reads();
    tab.driver.refresh();
    const during = tab.reads();
    await tab.found(listOf([offer('a')]));
    const after = tab.reads();
    await tab.found(listOf([offer('a'), offer('b')]));
    assert({
      given: 'a refresh, and another while the first read is in flight',
      should:
        'read at once, read once more after the first answers, and show the newest answer',
      actual: { reads: [first, during, after], waiting: tab.waiting() },
      expected: { reads: [1, 1, 2], waiting: [offerId('a'), offerId('b')] },
    });
    tab.driver.dispose();
  });

  test('a failed read keeps what is shown', async () => {
    const tab = harness(listOf([offer('a')]));
    tab.driver.refresh();
    tab.answer(new Error('offline'));
    await tab.flush();
    tab.driver.refresh();
    tab.answer({ kind: 'unavailable' });
    await tab.flush();
    assert({
      given: 'a read that throws and a read that is refused',
      should: 'keep the offer waiting, with no notice, as stale',
      actual: [tab.waiting(), tab.ended(), tab.driver.readSnapshot().freshness],
      expected: [[offerId('a')], [], 'stale'],
    });
    tab.driver.dispose();
  });

  test('an offer the member is cancelling ends without a notice, unless the cancel was refused', async () => {
    const tab = harness(listOf([offer('a'), offer('b')]));
    tab.driver.cancelling(offerId('a'));
    tab.driver.cancelling(offerId('b'));
    tab.driver.cancelRefused(offerId('b'));
    tab.driver.refresh();
    await tab.found(listOf());
    const ended = tab.ended();
    tab.driver.dismiss(offerId('b'));
    assert({
      given:
        'two offers being cancelled, one cancel refused, then both read as gone',
      should:
        'say only the refused one ended, until the member dismisses that notice',
      actual: [ended, tab.ended()],
      expected: [[{ id: offerId('b'), username: 'mara' }], []],
    });
    tab.driver.dispose();
  });

  test('listeners hear a change in what is held, and nothing after disposal', async () => {
    const tab = harness(listOf([offer('a')]));
    let heard = 0;
    tab.driver.subscribe(() => {
      heard += 1;
    });
    tab.driver.cancelling(offerId('a'));
    tab.driver.cancelling(offerId('a'));
    tab.driver.dismiss(offerId('a'));
    const commands = heard;
    tab.driver.dispose();
    tab.driver.cancelRefused(offerId('a'));
    assert({
      given:
        'a cancel noted twice, a dismissal that names no notice, then disposal',
      should: 'tell listeners of the one change only, and release every edge',
      actual: [commands, heard, tab.log.slice(-3), tab.timers()],
      expected: [1, 1, ['unsubscribe', 'dispose', 'visibility released'], []],
    });
  });

  test('a read that changes nothing a reader uses tells no listener', async () => {
    const tab = harness(listOf([offer('a')], [], ['i']));
    let heard = 0;
    tab.driver.subscribe(() => {
      heard += 1;
    });
    const held = tab.driver.readSnapshot().value;
    tab.advance(OFFER_WATCH_MS);
    await tab.found(listOf([offer('a')], [], ['i']));
    const same = [heard, tab.driver.readSnapshot().value === held];
    tab.advance(OFFER_WATCH_MS);
    await tab.found(listOf([offer('a'), offer('b')], [], ['i']));
    const changed = heard;
    tab.advance(OFFER_WATCH_MS);
    tab.answer({ kind: 'unavailable' });
    await tab.flush();
    assert({
      given:
        'an open offer watched through a read of the identical list, a read with one more offer, then a refused read',
      should:
        'tell listeners nothing and keep what is held for the first, and tell them once each for the new list and for going stale',
      actual: {
        same,
        changed,
        stale: [heard, tab.driver.readSnapshot().freshness],
        reads: tab.reads(),
      },
      expected: {
        same: [0, true],
        changed: 1,
        stale: [2, 'stale'],
        reads: 3,
      },
    });
    tab.driver.dispose();
  });

  test('the snapshot is one object until something in it changes', async () => {
    const tab = harness(listOf([offer('a')]));
    const seeded = tab.driver.readSnapshot();
    const again = tab.driver.readSnapshot();
    tab.driver.refresh();
    const reading = tab.driver.readSnapshot();
    assert({
      given: 'a snapshot read twice at rest, then with a read in flight',
      should:
        'hand back the same object at rest, and a current one that says a read is in flight',
      actual: [seeded === again, seeded.reading, reading.reading],
      expected: [true, false, true],
    });
    await tab.found(listOf([offer('a')]));
    tab.driver.dispose();
  });

  test('without realtime or a member no socket is opened', () => {
    const tab = harness(listOf([offer('a')]), { realtime: false });
    tab.advance(OFFER_WATCH_MS);
    assert({
      given: 'no inbox to subscribe to, and an offer open',
      should: 'open no connection and still read on the timer',
      actual: tab.log,
      expected: ['read'],
    });
    tab.driver.dispose();
  });
});
