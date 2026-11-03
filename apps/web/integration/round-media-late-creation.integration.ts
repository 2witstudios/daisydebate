import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMediaService } from '@daisy/media';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  withMediaRound,
  mediaDependencies,
  delayedMediaCreation,
  tokenClaims,
  waitForMediaFact,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const terminal of [false, true])
  test(`late actual creation after absence reaches only a retired room of a ${terminal ? 'terminal' : 'live'} session`, async () => {
    await withMediaRound(async (f) => {
      const delayed = delayedMediaCreation('before');
      let retiredRoom = '';
      const store = f.store.mediaSessions;
      const operations = createRoundMediaOperations({
        ...mediaDependencies(f, createMediaService({ config: delayed.config })),
        store: {
          ...store,
          finishMediaReconcile: async (request) => {
            const [named] =
              await f.sql`select room_name from media_sessions where id=${request.sessionId}`;
            retiredRoom = String(named!.room_name);
            // The provider effect and actual settlement occur after cleanup's absence read,
            // before the real bounded finalization transaction obtains its locks.
            if (terminal)
              await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${f.roundId}`;
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
        // The retiring request answers the retryable 503; the browser's next one joins.
        await operations
          .session(f.roundId, f.host.actorId)
          .catch(() => undefined);
        const [session] =
          await f.sql`select id,room_name,unsafe_at,ended_at from media_sessions where round_id=${f.roundId}`;
        assert({
          given: 'a real provider creation settling after the absence read',
          should:
            'leave that room behind: a live session names a fresh room, a terminal one has ended',
          actual: [
            await f.media.exists(retiredRoom),
            session!.room_name !== retiredRoom,
            session!.unsafe_at,
            session!.ended_at !== null,
          ],
          expected: [true, !terminal, null, terminal],
        });
        if (!terminal) {
          const back = await operations.session(f.roundId, f.host.actorId);
          const [now] =
            await f.sql`select room_name from media_sessions where id=${session!.id}`;
          assert({
            given: 'the next admission after retirement',
            should: 'sign for the fresh room, never the retired one',
            actual: tokenClaims(back.token).video.room,
            expected: now!.room_name,
          });
        }
        await f.media.deleteRoom(retiredRoom);
      } finally {
        delayed.release();
        delayed.stop();
      }
    });
  });
