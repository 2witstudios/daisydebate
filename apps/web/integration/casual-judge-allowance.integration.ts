import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { assertRejects } from '@daisy/errors/testing';
import { botAdmissionForTests } from './bot-admission.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import {
  assembleJudgedRoom,
  frozenBotJudgeRound,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a human-only casual Round reserves its included judge without bot capacity', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await frozenBotJudgeRound(f, true);
    const rows =
      await f.sql`select kind,source->>'kind' as source,state->>'kind' as state from usage_reservations where round_id=${roundId}`;
    assert({
      given:
        'a real human-versus-human casual Room with an assigned Premium-beta AI judge, launched without a bot busy cap',
      should:
        'reserve the judge once in the shared ledger before any model dispatch',
      actual: rows.map((r: { kind: string; source: string; state: string }) => [
        r.kind,
        r.source,
        r.state,
      ]),
      expected: [['casual_ai_judge', 'beta', 'reserved']],
    });
  });
});

test('the first free bot debate includes its optional judge through actual Room creation and launch', async () => {
  await withRoomRuntime(async (f) => {
    await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
    const bot = await f.bot(),
      judge = await f.aiJudge();
    const catalog = await f.operations.catalog(f.host);
    let view = (
      await f.create({
        selection: {
          ...f.foundationSelection,
          definition: {
            ...f.foundationSelection.definition,
            seats: { ...f.foundationSelection.definition.seats, judge: 1 },
          },
        },
        cast: [
          { actorId: bot.actorId, role: 'negative', slot: 0 },
          { actorId: judge.actorId, role: 'judge', slot: 0 },
        ],
      })
    ).view;
    const offered = view.aiJudgeSeating;
    view = (
      await f.command(f.host, view, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    view = (await f.consent(f.host, view, 'ready')).view;
    const { roundId } = await launchRuntimeRound(f, view);
    const rows =
      await f.sql`select kind, source, state, binds_free_judge from usage_reservations where round_id=${roundId} order by kind`;
    assert({
      given:
        'an admitted member with no Premium grant choosing the first bot debate plus judge',
      should:
        'offer the free bundle, admit both atomically on launch, bind its exact Round and spend neither at claim time',
      actual: [
        catalog.botDebateAiJudge,
        offered,
        rows.map(
          (row: {
            kind: string;
            source: unknown;
            state: unknown;
            binds_free_judge: boolean;
          }) => [row.kind, row.source, row.state, row.binds_free_judge],
        ),
        (await f.operations.catalog(f.host)).botDebateAiJudge,
      ],
      expected: [
        true,
        'free',
        [
          ['ai_round', { kind: 'lifetime' }, { kind: 'reserved' }, true],
          [
            'casual_ai_judge',
            { kind: 'lifetime' },
            { kind: 'reserved' },
            false,
          ],
        ],
        false,
      ],
    });
  }, botAdmissionForTests);
});

test('the free judge cannot be seated alone on a human debate', async () => {
  await withRoomRuntime(async (f) => {
    await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
    const room = await assembleJudgedRoom(f);
    const judge = await f.aiJudge();
    const before = await f.snapshot(room.id);
    await assertRejects({
      given: 'a free account requesting a standalone judge for a human debate',
      should: 'refuse the unrelated free judge',
      code: 'CONFLICT',
      actual: () =>
        f.command(f.host, room, {
          type: 'assign-seat',
          actorId: judge.actorId,
          role: 'judge',
          slot: 0,
        }),
    });
    assert({
      given: 'the refused standalone judge request',
      should: 'leave Room, seats and durable writes unchanged',
      actual: await f.snapshot(room.id),
      expected: before,
    });
  });
});
