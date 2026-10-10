import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { withRoomRuntime } from './room-runtime.test-support';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';

requireTestServices(process.env);
setupRitewayBun();

type RuntimeFixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

async function setPrivate(
  f: RuntimeFixture,
  view: RoomView,
): Promise<RoomView> {
  return (
    await f.command(f.host, view, {
      type: 'update-details',
      title: view.title,
      topic: view.topic,
      visibility: 'private',
    })
  ).view;
}

function assertMinimalProjection(
  resource: {
    readonly kind: 'room' | 'round';
    readonly revision: number;
    readonly participants: readonly { readonly actorId: string }[];
  },
  hostActorId: string,
  guestActorId: string,
) {
  const keys =
    resource.kind === 'room'
      ? [
          'hostActorId',
          'kind',
          'participants',
          'revision',
          'roomId',
          'status',
          'visibility',
        ]
      : [
          'createdByActorId',
          'kind',
          'participants',
          'revision',
          'roundId',
          'status',
          'visibility',
        ];
  assert({
    given: `a durable ${resource.kind} authorization projection`,
    should: 'contain only audience metadata and persisted actor facts',
    actual: [
      Object.keys(resource).sort(),
      resource.revision,
      resource.participants.map(({ actorId }) => actorId).sort(),
    ],
    expected: [keys, resource.revision, [hostActorId, guestActorId].sort()],
  });
}

test('minimal Room authority facts retain membership without hydrating private content', async () => {
  await withRoomRuntime(async (f) => {
    const view = await setPrivate(f, await f.assemble());
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
      assertMinimalProjection(facts.resource, f.host.actorId, f.guest.actorId);
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

test('minimal Round authority facts authorize only the persisted private cast', async () => {
  await withRoomRuntime(async (f) => {
    const view = await setPrivate(f, await f.assemble());
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
    const decisions = [];
    for (const caller of [f.host, f.guest, f.outsider]) {
      const facts = await f.store.readRoundAuthorizationFacts(roundId, caller);
      if (!facts) throw new Error('Fixture Round authority facts missing');
      decisions.push(
        authorize({
          principal: { kind: 'user', ...caller },
          capability: 'round.read',
          context: { account: facts.account },
          resource: facts.resource,
        }).allow,
      );
      assertMinimalProjection(facts.resource, f.host.actorId, f.guest.actorId);
    }
    assert({
      given: 'the private Round creator, a frozen participant, and an outsider',
      should: 'leave round.read to the canonical evaluator',
      actual: decisions,
      expected: [true, true, false],
    });
    const phaseRows = await f.sql`
      select kind, version, payload from outbox
      where topic=${buildDebateTopic(roundId)} order by seq
    `;
    assert({
      given: 'the Room launch that created this private Round',
      should: 'append one canonical scheduled-phase signal',
      actual: phaseRows,
      expected: [
        {
          kind: 'debate.phase-changed',
          version: 1,
          payload: {
            kind: 'debate.phase-changed',
            ids: [roundId],
            entityVersion: 1,
          },
        },
      ],
    });
  });
});
