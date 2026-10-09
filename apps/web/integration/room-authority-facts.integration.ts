import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { withRoomRuntime } from './room-runtime.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';

requireTestServices(process.env);
setupRitewayBun();

test('minimal Room authority facts retain membership without hydrating private content', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (
      await f.command(f.host, view, {
        type: 'update-details',
        title: view.title,
        topic: view.topic,
        visibility: 'private',
      })
    ).view;
    const decisions = [];
    for (const caller of [f.guest, f.outsider]) {
      const facts = await f.store.readRoomAuthorizationFacts(view.id, caller);
      if (!facts) throw new Error('Fixture Room authority facts missing');
      decisions.push(
        authorize({
          principal: { kind: 'user', ...caller },
          capability: 'room.read',
          context: { account: facts.account },
          resource: facts.resource,
        }).allow,
      );
      assert({
        given: 'a durable Room authority projection for realtime',
        should:
          'contain only canonical authorization metadata and seated actor facts',
        actual: [
          Object.keys(facts.resource).sort(),
          facts.resource.revision,
          facts.resource.participants.map((p) => p.actorId).sort(),
        ],
        expected: [
          [
            'hostActorId',
            'kind',
            'participants',
            'revision',
            'roomId',
            'status',
            'visibility',
          ],
          view.version,
          [f.host.actorId, f.guest.actorId].sort(),
        ],
      });
    }
    assert({
      given: 'a seated current member and an outsider reading a private Room',
      should:
        'leave the sole canonical evaluator to allow and deny respectively',
      actual: decisions,
      expected: [true, false],
    });
  });
});
