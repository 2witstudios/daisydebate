import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createMediaService } from '@daisy/media';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  withMediaRound,
  mediaDependencies,
  delayedMediaCreation,
  waitForMediaFact,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const terminal of [false, true])
  test(`late actual creation after absence cannot finalize a ${terminal ? 'terminal' : 'live'} session`, async () => {
    await withMediaRound(async (f) => {
      const delayed = delayedMediaCreation('before');
      const store = f.store.mediaSessions;
      const operations = createRoundMediaOperations({
        ...mediaDependencies(f, createMediaService({ config: delayed.config })),
        store: {
          ...store,
          finishMediaReconcile: async (request) => {
            // The provider effect and actual settlement occur after cleanup's absence read,
            // before the real bounded finalization transaction obtains its locks.
            if (terminal)
              await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${f.roundId}`;
            delayed.release();
            await waitForMediaFact(async () => {
              const [row] =
                await f.sql`select count(*)::int n from media_vendor_mutations where session_id=${request.sessionId} and settled_at is null`;
              return row!.n === 0;
            });
            return store.finishMediaReconcile(request);
          },
        },
      });
      try {
        await assertRejects({
          given:
            'a real provider creation settling between absence and finalization',
          should: 'keep admission refused despite the now-settled intent',
          code: 'INFRASTRUCTURE',
          actual: () => operations.session(f.roundId, f.host.actorId),
        });
        const [session] =
          await f.sql`select id,room_name,unsafe_at,ended_at from media_sessions where round_id=${f.roundId}`;
        assert({
          given: 'the late room exists after the stale absence read',
          should:
            'retain unsafe state and remain discoverable for durable recovery',
          actual: [
            await f.media.exists(session!.room_name),
            session!.unsafe_at !== null,
            session!.ended_at,
            (await store.activeMediaSessions()).some(
              (active) => active.roundId === f.roundId,
            ),
          ],
          expected: [true, true, null, true],
        });
        await f.mediaOperations.recoverActiveSessions();
        const [recovered] =
          await f.sql`select unsafe_at,ended_at from media_sessions where id=${session!.id}`;
        assert({
          given: 'a later run starting after actual creation settlement',
          should:
            'clean up the real room before clearing uncertainty or stamping terminal end',
          actual: [
            await f.media.exists(session!.room_name),
            recovered!.unsafe_at,
            recovered!.ended_at !== null,
          ],
          expected: [false, null, terminal],
        });
      } finally {
        delayed.release();
        delayed.stop();
      }
    });
  });
