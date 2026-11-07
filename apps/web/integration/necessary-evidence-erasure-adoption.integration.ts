import { requireTestServices } from '@daisy/config';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { subjectRightsVerificationBindings } from '@daisy/db/privacy';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);
const transitions = { activeRoomMembers, closeRoom, eraseSeats };

test('canonical account closure commits one private evidence cleanup request without a custody dependency', async () => {
  await withRoomRuntime(async (f) => {
    const input = {
      subject: f.host,
      now: new Date().toISOString(),
      vendors: [],
      jobIds: [],
    };
    try {
      const first = await f.store.erasePrivacySubject(
        input,
        transitions,
        subjectRightsVerificationBindings,
      );
      const again = await f.store.erasePrivacySubject(
        input,
        transitions,
        subjectRightsVerificationBindings,
      );
      const [registered] =
        await f.sql`select to_regclass('necessary_evidence_erasure_requests')::text as name`;
      const [closed] =
        await f.sql`select deleted_at is not null as erased from users where id=${f.host.userId}`;
      const rows = registered!.name
        ? await f.sql`select actor_id,user_id from necessary_evidence_erasure_requests where actor_id=${f.host.actorId}`
        : [];
      assert({
        given:
          'the actual canonical erasure composition and an idempotent retry, with no custody/vendor resource supplied',
        should:
          'close locally and atomically retain exactly one original-subject cleanup request, without adding account lock upgrades or audio loops',
        actual: {
          first: first.alreadyErased,
          again: again.alreadyErased,
          closed: closed!.erased,
          rows: [...rows],
        },
        expected: {
          first: false,
          again: true,
          closed: true,
          rows: [{ actor_id: f.host.actorId, user_id: f.host.userId }],
        },
      });
    } finally {
      const [registered] =
        await f.sql`select to_regclass('necessary_evidence_erasure_requests')::text as name`;
      if (registered!.name)
        await f.sql`delete from necessary_evidence_erasure_requests where actor_id=${f.host.actorId}`;
    }
  });
});
