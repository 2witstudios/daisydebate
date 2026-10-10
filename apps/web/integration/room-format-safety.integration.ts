import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { executeRoomCommand } from '@daisy/debate-engine';
import { assertRejects } from '@daisy/errors/testing';
import {
  practiceFormatFixture,
  invalidFormatDefinitions,
  unsafeFormatDefinitions,
} from '@daisy/protocol/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('unsafe custom create and update preserve Room, definitions, receipts and outbox', async () => {
  await withRoomRuntime(async (f) => {
    const view = (await f.create()).view;
    const config = {
      ...view.config,
      inRoundPrep: { enabled: false as const },
      speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
      interruptions: { mode: 'disabled' as const, minRemainingMs: 0 },
      yielding: { allowed: false, returnsTime: false },
    };
    const valid = await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...practiceFormatFixture,
          seats: { affirmative: 2, negative: 1, judge: 0 },
        },
        config,
        length: 'full',
        competitionType: 'casual',
      },
    });
    assert({
      given:
        'the same admission fixture with safe asymmetric seats and no judges',
      should:
        'persist successfully so unsafe refusals cannot come from unrelated config',
      actual: valid.view.definition.seats,
      expected: { affirmative: 2, negative: 1, judge: 0 },
    });
    const snapshot = await f.snapshot(view.id);
    const inventory = async () =>
      JSON.stringify(
        await f.sql`
      select
        (select coalesce(json_agg(r order by id),'[]'::json) from rooms r where host_actor_id=${f.host.actorId}) rooms,
        (select coalesce(json_agg(r order by id),'[]'::json) from formats r where created_by_actor_id=${f.host.actorId}) formats,
        (select coalesce(json_agg(r order by format_id,version),'[]'::json) from format_revisions r where format_id in (select id from formats where created_by_actor_id=${f.host.actorId})) definitions,
        (select coalesce(json_agg(r order by command_id),'[]'::json) from room_commands r where actor_id=${f.host.actorId}) receipts,
        (select coalesce(json_agg(r order by seq),'[]'::json) from outbox r where topic in (select 'room:' || id from rooms where host_actor_id=${f.host.actorId})) outbox`,
      );
    const before = await inventory();
    for (const [name, definition] of [
      ...invalidFormatDefinitions,
      ...unsafeFormatDefinitions,
    ]) {
      await assertRejects({
        given: `custom create with ${name}`,
        should: 'refuse before publishing any durable state',
        actual: () =>
          f.create({
            selection: {
              kind: 'custom',
              definition,
              config,
              length: 'full',
              competitionType: 'casual',
            },
          }),
        code: 'VALIDATION',
      });
      await assertRejects({
        given: `custom update with ${name}`,
        should: 'refuse before changing Room or publishing a definition',
        actual: () =>
          f.command(f.host, view, {
            type: 'update-format',
            definition,
            config,
          }),
        code: 'CONFLICT',
      });
      assert({
        given: `${name} create and update refusals`,
        should:
          'preserve complete Room, definitions, command receipts and outbox',
        actual: [await f.snapshot(view.id), await inventory()],
        expected: [snapshot, before],
      });
    }
  });
});

test('direct domain Launch safety refusal cannot persist a Round or freeze', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    const snapshot = await f.snapshot(view.id);
    for (const [name, definition] of unsafeFormatDefinitions) {
      await assertRejects({
        given: `a direct caller supplies ${name} to Launch without parsing`,
        should: 'refuse inside the real Room transaction',
        actual: () =>
          f.store.executeRoomCommand({
            caller: f.host,
            actorId: f.host.actorId,
            roomId: view.id,
            commandId: createId(),
            payloadDigest: 'direct-launch-safety-proof',
            type: 'start-round',
            targetActorId: null,
            roundId: createId(),
            authorizeRead: () => true,
            execute: async (room, now) =>
              executeRoomCommand(
                {
                  ...room,
                  rules: {
                    ...room.rules,
                    seats: definition.seats,
                    segments: definition.segments.map(
                      ({ defaultDurationMs, ...s }) => ({
                        ...s,
                        durationMs: defaultDurationMs,
                      }),
                    ),
                  },
                  participants:
                    definition.seats.negative === 0
                      ? room.participants.filter((p) => p.role !== 'negative')
                      : room.participants,
                },
                f.host.actorId,
                {
                  type: 'start-round',
                  commandId: 'direct-proof',
                  expectedVersion: room.version,
                },
                {
                  available: true,
                  readyActorIds: room.participants.map((p) => p.actorId),
                },
                {
                  now,
                  participantId: createId(),
                  formatId: createId(),
                  target: null,
                },
              ),
          }),
        code: 'CONFLICT',
      });
      assert({
        given: `direct ${name} Launch refusal`,
        should:
          'leave Room, receipts, outbox and absent Round exactly unchanged',
        actual: await f.snapshot(view.id),
        expected: snapshot,
      });
    }
  });
});
