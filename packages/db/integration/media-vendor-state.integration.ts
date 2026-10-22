import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { mediaVendorMutations } from '../src/schema/media-vendor-mutations';
import { rejectedBy, withFixture } from './constraint-helpers';
import { captureSchemaStream } from './capture-schema.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('vendor uncertainty preserves immutable intent and blocks unsafe session reopening', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId } = await captureSchemaStream(fixture);
    try {
      const sessionId = createId(),
        mutationId = createId(),
        identity = createId();
      await fixture.insert('media_sessions', {
        id: sessionId,
        round_id: roundId,
        room_name: createId(),
      });
      const mutation = (overrides: Record<string, unknown> = {}) =>
        fixture.insert('media_vendor_mutations', {
          id: createId(),
          session_id: sessionId,
          epoch: 0,
          kind: 'permissions',
          identity,
          payload: {
            publish: ['camera', 'microphone'],
            subscribe: true,
            hidden: false,
            capture: false,
          },
          ...overrides,
        });
      await mutation({ id: mutationId });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=clock_timestamp() where id=$1',
        [sessionId],
      );
      assert({
        given: 'a dispatched vendor operation with no known outcome',
        should:
          'retain pending state and forbid intent rewrite or unsafe clearing',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update media_sessions set unsafe_at=null where id=$1',
              [sessionId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              "update media_vendor_mutations set payload='{}'::jsonb where id=$1",
              [mutationId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'delete from media_vendor_mutations where id=$1',
              [mutationId],
            ),
          ),
        ]),
        expected: [
          'media_sessions_pending_unsafe',
          'media_vendor_mutations_immutable',
          'media_vendor_mutations_pending',
        ],
      });
      const payloads = [
        {
          publish: ['camera', 'camera'],
          subscribe: true,
          hidden: false,
          capture: false,
        },
        { publish: [], subscribe: true, hidden: false, capture: true },
        {
          publish: [],
          subscribe: true,
          hidden: false,
          capture: false,
          credential: 'forbidden-synthetic-field',
        },
      ];
      assert({
        given:
          'duplicate sources, capture escalation or an extra credential field',
        should: 'reject every untrusted intent payload',
        actual: await Promise.all(
          payloads.map((payload) => rejectedBy(() => mutation({ payload }))),
        ),
        expected: payloads.map(() => 'media_vendor_mutations_payload_check'),
      });
      assert({
        given: 'a room mutation carrying a participant identity',
        should: 'reject the inconsistent intent scope',
        actual: await rejectedBy(() =>
          mutation({ kind: 'create', payload: {} }),
        ),
        expected: 'media_vendor_mutations_identity_check',
      });
      await fixture.sql.unsafe(
        "update media_vendor_mutations set settled_at=clock_timestamp(),outcome='failed' where id=$1",
        [mutationId],
      );
      assert({
        given: 'a settled failed vendor outcome',
        should: 'refuse rewriting success',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "update media_vendor_mutations set outcome='succeeded' where id=$1",
            [mutationId],
          ),
        ),
        expected: 'media_vendor_mutations_immutable',
      });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=null where id=$1',
        [sessionId],
      );
      await fixture.sql.unsafe(
        'update media_sessions set reconcile_epoch=1 where id=$1',
        [sessionId],
      );
      assert({
        given: 'an established reconciliation epoch',
        should: 'refuse decreasing it',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            'update media_sessions set reconcile_epoch=0 where id=$1',
            [sessionId],
          ),
        ),
        expected: 'media_sessions_reconcile_epoch_immutable',
      });
      assert({
        given: 'an owner without a matching lease deadline',
        should: 'refuse ambiguous reconciliation authority',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            'update media_sessions set reconcile_owner=$2 where id=$1',
            [sessionId, createId()],
          ),
        ),
        expected: 'media_sessions_reconcile_lease_check',
      });
      await fixture.sql.unsafe(
        'update media_sessions set reconcile_request_version=1,reconcile_running_version=1 where id=$1',
        [sessionId],
      );
      await fixture.sql.unsafe(
        'update media_sessions set reconcile_request_version=2 where id=$1',
        [sessionId],
      );
      await fixture.sql.unsafe(
        'update media_sessions set reconcile_served_version=reconcile_running_version where id=$1',
        [sessionId],
      );
      const [versions] = await fixture.sql.unsafe(
        'select reconcile_request_version as requested,reconcile_running_version as running,reconcile_served_version as served from media_sessions where id=$1',
        [sessionId],
      );
      assert({
        given: 'a second request during a claimed run with the same timestamp',
        should: 'retain the unserved version after older run completion',
        actual: versions,
        expected: { requested: 2, running: 1, served: 1 },
      });
      assert({
        given: 'a version decrease or serving a future unclaimed request',
        should: 'refuse invalid completion fences',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update media_sessions set reconcile_request_version=1 where id=$1',
              [sessionId],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update media_sessions set reconcile_served_version=2 where id=$1',
              [sessionId],
            ),
          ),
        ]),
        expected: [
          'media_sessions_reconcile_epoch_immutable',
          'media_sessions_reconcile_versions_check',
        ],
      });
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      assert({
        given: 'owning Round erasure',
        should: 'cascade settled vendor intent and its session',
        actual: await fixture.count(
          'media_vendor_mutations',
          'session_id',
          sessionId,
        ),
        expected: 0,
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('typed vendor payload refuses extra keys before driver I/O', async () => {
  await assertRejects({
    given: 'a permission intent carrying a credential field',
    should: 'reject at the serialization boundary',
    code: 'VALIDATION',
    actual: async () =>
      mediaVendorMutations.payload.mapToDriverValue({
        publish: [],
        subscribe: true,
        hidden: false,
        capture: false,
        credential: 'synthetic-forbidden',
      }),
  });
});
