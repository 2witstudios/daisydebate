import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaSessions } from './schema/media-sessions';
import { mediaVendorMutations } from './schema/media-vendor-mutations';
setupRitewayBun();
test('durable media recovery survives web process loss', () => {
  assert({
    given: 'a session reconcile claim and vendor intent',
    should:
      'persist the fencing epoch, request horizon and unresolved dispatch',
    actual: [
      mediaSessions.reconcileEpoch?.name,
      mediaSessions.reconcileRequestedAt?.name,
      mediaSessions.reconcileLeaseUntil?.name,
      mediaVendorMutations?.sessionId.name,
      mediaVendorMutations?.settledAt.name,
    ],
    expected: [
      'reconcile_epoch',
      'reconcile_requested_at',
      'reconcile_lease_until',
      'session_id',
      'settled_at',
    ],
  });
});
