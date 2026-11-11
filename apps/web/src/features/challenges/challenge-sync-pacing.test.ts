import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ChallengeList } from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';
import { driverEdges } from '../resource-sync/driver.test-support';
import {
  CHALLENGE_BACKSTOP_MS,
  createChallengeSyncDriver,
  OFFER_WATCH_MS,
} from './challenge-sync-driver';
import { listOf, offer, offerId } from './challenges-held.test-support';
import { CHALLENGE_TTL_MS } from './operations';

setupRitewayBun();

function harness(seed: ChallengeList) {
  const edges = driverEdges<ResourceRead<ChallengeList>>();
  const driver = createChallengeSyncDriver({
    seed,
    read: edges.read,
    inbox: { actorId: offerId('m'), connection: edges.connection },
    scheduler: edges.scheduler,
    visibility: edges.visibility,
  });
  const found = async (list: ChallengeList) => {
    edges.answer({ kind: 'found', value: list });
    await edges.flush();
  };
  return { ...edges, driver, found };
}

describe('challenge sync pacing (DEC-384)', () => {
  test('after a failed read an open offer is next read on the backstop, several times within its life', async () => {
    const tab = harness(listOf([offer('a')]));
    tab.advance(OFFER_WATCH_MS);
    tab.answer(new Error('offline'));
    await tab.flush();
    const failed = tab.reads();
    tab.advance(OFFER_WATCH_MS);
    const watch = tab.reads();
    tab.advance(CHALLENGE_BACKSTOP_MS - OFFER_WATCH_MS - 1);
    const early = tab.reads();
    tab.advance(1);
    const retried = tab.reads();
    await tab.found(listOf([offer('a')]));
    tab.advance(OFFER_WATCH_MS);
    assert({
      given:
        'an offer open, its five-second check failing, then the retry answering',
      should:
        'not retry on the five-second watch, retry thirty seconds after the failure, then watch every five seconds again; with at least three retries inside an offer’s life',
      actual: {
        reads: [failed, watch, early, retried, tab.reads()],
        retriesInAnOffersLife: Math.floor(
          CHALLENGE_TTL_MS / CHALLENGE_BACKSTOP_MS,
        ),
      },
      expected: { reads: [1, 1, 1, 2, 3], retriesInAnOffersLife: 4 },
    });
    tab.driver.dispose();
  });

  test('a hidden tab keeps the five-second watch but has no backstop, so a failed read waits for the tab to be shown', async () => {
    const tab = harness(listOf([offer('a')]));
    tab.hide();
    tab.advance(OFFER_WATCH_MS);
    const watched = tab.reads();
    await tab.found(listOf([offer('a')]));
    tab.advance(OFFER_WATCH_MS);
    const again = tab.reads();
    tab.answer(new Error('offline'));
    await tab.flush();
    for (let passed = 0; passed < CHALLENGE_TTL_MS; passed += OFFER_WATCH_MS)
      tab.advance(OFFER_WATCH_MS);
    const unread = tab.reads();
    tab.show();
    assert({
      given:
        'a hidden tab with an offer open, two checks, the second failing, then an offer’s whole life hidden, then the tab shown',
      should:
        'check every five seconds while reads answer, read nothing after the failure for as long as it stays hidden, and read at once when shown',
      actual: [watched, again, unread, tab.reads()],
      expected: [1, 2, 2, 3],
    });
    tab.driver.dispose();
  });

  test('a hidden tab with no offer open reads nothing until it is shown', () => {
    const tab = harness(listOf([], ['a']));
    tab.hide();
    tab.advance(CHALLENGE_BACKSTOP_MS);
    tab.advance(CHALLENGE_BACKSTOP_MS);
    const hidden = tab.reads();
    tab.show();
    assert({
      given: 'a hidden tab with no offer open, across two backstop intervals',
      should: 'read nothing while hidden and read at once when shown',
      actual: [hidden, tab.reads()],
      expected: [0, 1],
    });
    tab.driver.dispose();
  });
});
