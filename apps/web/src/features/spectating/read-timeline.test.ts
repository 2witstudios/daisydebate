import { audienceStatePath } from '@daisy/protocol';
import { audienceStateKey } from '@daisy/db/audience-state-key';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readWatchRound, type AudienceSnapshot } from './read-timeline';

setupRitewayBun();

const roundId = 'a'.repeat(24);
const origin = 'https://public.invalid';
const snapshot = {
  visibility: 'unlisted',
  timeline: {},
  feedKey: 'feed',
} as unknown as AudienceSnapshot;

test('an admitted reader gets the state of the link they presented', async () => {
  const stored = ['one', 'two'];
  let reads = 0;
  const round = await readWatchRound(
    {
      snapshots: async () => snapshot,
      store: {
        // A second read would see the replaced link.
        readRoundAudienceLink: (async () => ({
          visibility: 'unlisted',
          audienceLinkHash: stored[reads++],
        })) as never,
      },
      publicOrigin: origin,
    },
    { roundId, presentedHash: 'one' },
  );
  assert({
    given: 'a link replaced just after admission',
    should: 'read the link once and never hand out the new address',
    actual: [reads, round?.stateUrl],
    expected: [
      1,
      new URL(audienceStatePath(audienceStateKey('feed', 'one')), origin).href,
    ],
  });
});
