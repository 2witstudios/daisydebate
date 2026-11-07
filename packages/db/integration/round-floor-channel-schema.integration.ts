import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  readMessagingChannelFact,
  readMessagingChannelFacts,
} from '../src/messaging/social';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const channel = (roundId: string, kind: 'round_floor' | 'round_spectator') => ({
  id: createId(),
  kind,
  policy_key: kind === 'round_floor' ? 'round.floor' : 'round.spectator',
  policy_revision: 1,
  lifecycle: 'active',
  round_id: roundId,
});

describe('Round floor channel identity (RCHAT-2)', () => {
  test('floor and spectator coexist', async () => {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      try {
        await f.insert(
          'messaging_channels',
          channel(roundId, 'round_spectator'),
        );
        const refusal = await f.rejectedBy(
          'messaging_channels',
          channel(roundId, 'round_floor'),
        );
        assert({
          given: 'a Round with a spectator conversation',
          should: 'also admit its distinct floor conversation',
          actual: refusal,
          expected: null,
        });
      } finally {
        await f.sql`delete from messaging_channels where round_id=${roundId}`;
      }
    });
  });

  test('one channel per kind and Round', async () => {
    await withFixture(databaseUrl, async (f) => {
      const first = await f.round();
      const second = await f.round();
      try {
        await f.insert('messaging_channels', channel(first, 'round_floor'));
        await f.insert('messaging_channels', channel(first, 'round_spectator'));
        assert({
          given: 'a Round with a floor and spectator channel',
          should:
            'reject duplicates of each while admitting another Round’s floor',
          actual: [
            await f.rejects(
              'messaging_channels',
              channel(first, 'round_floor'),
            ),
            await f.rejects(
              'messaging_channels',
              channel(first, 'round_spectator'),
            ),
            await f.rejects(
              'messaging_channels',
              channel(second, 'round_floor'),
            ),
          ],
          expected: [true, true, false],
        });
      } finally {
        await f.sql`delete from messaging_channels where round_id in (${first},${second})`;
      }
    });
  });

  test('exact association and policy', async () => {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      const floor = channel(roundId, 'round_floor');
      try {
        assert({
          given:
            'a floor channel with a missing or mismatched association or policy',
          should: 'refuse every malformed boundary',
          actual: [
            await f.rejects('messaging_channels', { ...floor, round_id: null }),
            await f.rejects('messaging_channels', {
              ...floor,
              round_id: createId(),
            }),
            await f.rejects('messaging_channels', {
              ...floor,
              policy_key: 'round.spectator',
            }),
            await f.rejects('messaging_channels', {
              ...floor,
              policy_key: 'social.private_group',
            }),
            await f.rejects('messaging_channels', {
              ...floor,
              kind: 'private_group',
              policy_key: 'social.private_group',
            }),
          ],
          expected: [true, true, true, true, true],
        });
      } finally {
        await f.sql`delete from messaging_channels where id=${floor.id}`;
      }
    });
  });

  for (const mode of ['single', 'batch'] as const) {
    test(`floor has no social authority (${mode})`, async () => {
      await withFixture(databaseUrl, async (f) => {
        const roundId = await f.round();
        const floor = channel(roundId, 'round_floor');
        const actorId = await f.participant(roundId, 'affirmative');
        try {
          await f.insert('messaging_channels', floor);
          const db = drizzle({ client: f.sql });
          const binding = { channelId: floor.id, actorId };
          assert({
            given: 'a floor channel and a real debater of its Round',
            should: 'remain absent to social-channel authority readers',
            actual:
              mode === 'single'
                ? await readMessagingChannelFact(db, floor.id, actorId)
                : await readMessagingChannelFacts(db, [binding]),
            expected: mode === 'single' ? null : [null],
          });
        } finally {
          await f.sql`delete from messaging_channels where id=${floor.id}`;
        }
      });
    });
  }
});
