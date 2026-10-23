import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { mediaDependencies, withMediaRound } from './round-media.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a definite LiveKit not-found settles the vendor mutation instead of wedging the session unsafe (ISSUE-464)', async () => {
  await withMediaRound(async (f) => {
    let ghost: string | null = null;
    // Real LiveKit throughout; only the listing reports a participant that has
    // already left, as after a reload between listing and update.
    const media = {
      ...f.media,
      publicationPermissions: async (room: string) =>
        ghost
          ? [
              {
                identity: ghost,
                grants: {
                  publish: ['microphone' as const],
                  subscribe: true,
                  hidden: false,
                  capture: false as const,
                },
                restricted: false,
              },
            ]
          : f.media.publicationPermissions(room),
    };
    const operations = createRoundMediaOperations(mediaDependencies(f, media));
    await operations.session(f.roundId, f.host.actorId);
    const [binding] =
      await f.sql`select p.identity from media_participants p join media_sessions s on s.id=p.session_id where s.round_id=${f.roundId}`;
    ghost = String(binding!.identity);
    await operations.session(f.roundId, f.host.actorId).catch(() => null);
    const [state] =
      await f.sql`select s.unsafe_at is null as safe,s.deletion_requested_at is null as kept,(select count(*)::int from media_vendor_mutations m where m.session_id=s.id and m.settled_at is null) pending,(select array_agg(outcome order by dispatched_at) from media_vendor_mutations m where m.session_id=s.id and m.kind='permissions') outcomes from media_sessions s where s.round_id=${f.roundId}`;
    assert({
      given: 'a permissions update for a participant LiveKit reports not found',
      should:
        'settle it as a definite failure and keep the session safe, open and unblocked',
      actual: state,
      expected: { safe: true, kept: true, pending: 0, outcomes: ['failed'] },
    });
  });
});
