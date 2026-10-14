import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { requireTestServices } from '@daisy/config';
import { openMessagingFixture } from './messaging-fixture.test-support';
import { sendMessagingMessage } from '../src/features/messaging/send';
import { mutateMessagingMessage } from '../src/features/messaging/mutate';
import { messagingMessageView } from '@daisy/protocol';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

async function withAppend(
  work: (world: Awaited<ReturnType<typeof appendWorld>>) => Promise<void>,
) {
  const world = await appendWorld();
  try {
    await work(world);
  } finally {
    await world.fixture.cleanup();
    await world.database.close();
    await world.client.close();
  }
}
async function appendWorld() {
  const world = await openMessagingFixture(databaseUrl);
  const dependencies = {
    bounds: { messageUnits: 4000, pageItems: 100 },
    editWindowMs: 60000,
    clock: { now: () => world.fixture.now },
    ids: { next: createId },
    store: world.database.messagingChannelStore(async () => {}),
    limit: async () => {},
  };
  const command = {
    version: 1 as const,
    channelId: world.fixture.channelId,
    requestId: createId(),
    text: 'Original',
  };
  const send = (input = command, limit = dependencies.limit) =>
    sendMessagingMessage(input, world.principal, { ...dependencies, limit });
  const snapshot = async () =>
    (
      await world.client.unsafe(
        `select message_sequence::text as sequence,change_version::text as version,
    (select count(*)::int from messaging_messages where channel_id=$1) as messages,
    (select count(*)::int from messaging_receipts where channel_id=$1) as receipts,
    (select count(*)::int from outbox where payload->>'channelId'=$1) as bells
    from messaging_channel_streams where channel_id=$1`,
        [world.fixture.channelId],
      )
    )[0];
  return { ...world, dependencies, command, send, snapshot };
}

test('one mixed batch commits allowed commands and preserves independent denials', () =>
  withAppend(async (world) => {
    const denied = world.database.messagingChannelStore(async () => {
      throw createAppError('AUTHORIZATION');
    });
    const denial = assertRejects({
      given: 'a denied actor interleaved with an allowed actor',
      should: 'refuse only the denied command',
      actual: () =>
        sendMessagingMessage(
          { ...world.command, requestId: createId() },
          world.principal,
          { ...world.dependencies, store: denied },
        ),
      code: 'AUTHORIZATION',
    });
    const allowed = await world.send();
    await denial;
    assert({
      given: 'one allowed command and one denied command',
      should: 'persist only the allowed message, counters, receipt and bell',
      actual: [allowed.sequence, await world.snapshot()],
      expected: [
        1,
        { sequence: '1', version: '1', messages: 1, receipts: 1, bells: 1 },
      ],
    });
  }));

test('durable replay bypasses admission after quota exhaustion or Redis outage', () =>
  withAppend(async (world) => {
    const first = await world.send();
    let calls = 0;
    const replay = await world.send(world.command, async () => {
      calls++;
      throw createAppError('INFRASTRUCTURE');
    });
    assert({
      given:
        'a committed receipt after expendable reservation loss and an offline limiter',
      should: 'return the current authorized message without any Redis call',
      actual: [replay.id, calls, await world.snapshot()],
      expected: [
        first.id,
        0,
        { sequence: '1', version: '1', messages: 1, receipts: 1, bells: 1 },
      ],
    });
  }));

test('a batch finalizes earlier edits and replay bytes against a later removal', () =>
  withAppend(async (world) => {
    const original = await world.send();
    const input = {
      version: 1 as const,
      channelId: world.fixture.channelId,
      messageId: original.id,
      requestId: createId(),
      text: 'Edited',
    };
    const editing = mutateMessagingMessage(
      'edit',
      input,
      world.principal,
      world.dependencies,
    );
    const removing = mutateMessagingMessage(
      'remove',
      { ...input, requestId: createId() },
      world.principal,
      world.dependencies,
    );
    const [edited, removed] = await Promise.all([editing, removing]);
    const [proof] = await world.client.unsafe(
      'select count(*)::int as retained from messaging_receipts where channel_id=$1 and payload_digest is not null',
      [world.fixture.channelId],
    );
    assert({
      given:
        'an accepted edit superseded in the same commit by an accepted removal',
      should:
        'acknowledge both using final unavailable bytes and retain no payload proof',
      actual: [
        messagingMessageView(edited),
        messagingMessageView(removed),
        proof.retained,
        await world.snapshot(),
      ],
      expected: [
        {
          id: original.id,
          channelId: original.channelId,
          sequence: 1,
          changeVersion: 3,
          unavailable: true,
        },
        {
          id: original.id,
          channelId: original.channelId,
          sequence: 1,
          changeVersion: 3,
          unavailable: true,
        },
        0,
        { sequence: '1', version: '3', messages: 1, receipts: 3, bells: 3 },
      ],
    });
  }));

for (const counter of ['message_sequence', 'change_version'] as const)
  test(`whole accepted batch rolls back ${counter} overflow`, () =>
    withAppend(async (world) => {
      const near = Number.MAX_SAFE_INTEGER - 1;
      await world.client.unsafe(
        'update messaging_channel_streams set message_sequence=$1,change_version=$2 where channel_id=$3',
        [
          counter === 'message_sequence' ? near : 0,
          near,
          world.fixture.channelId,
        ],
      );
      const before = await world.snapshot();
      const attempts = [
        world.send(),
        world.send({ ...world.command, requestId: createId() }),
      ];
      await Promise.all(
        attempts.map((attempt) =>
          assertRejects({
            given: 'two accepted allocations with room for only one',
            should: 'roll back the complete batch without a committed prefix',
            actual: () => attempt,
            code: 'INFRASTRUCTURE',
          }),
        ),
      );
      assert({
        given: 'the refused batch',
        should: 'leave both counters and all durable rows unchanged',
        actual: await world.snapshot(),
        expected: before,
      });
    }));
