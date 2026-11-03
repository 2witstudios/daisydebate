import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { isNamedSeat } from '@daisy/protocol';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { drawRoomOverrides } from './room-draw.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const lines = [1, 2, 3, 4, 5].map((n) => `Maintenance proof line ${n}`);

test('a tick settles only the strikes that are due, with nobody online', async () => {
  await withRoomRuntime(async (f) => {
    const overrides = await drawRoomOverrides(f, {
      kind: 'host',
      resolutions: lines,
    });
    // Two humans: the Negative's window is nowhere near due.
    const cast = await f.freshCast();
    const humans = await f.assemble(overrides, cast);
    const humanRound = (
      await f.command(cast.host, humans, { type: 'start-round' })
    ).view.roundRef!.id;
    // A bot Negative strikes first, automatically, three seconds after the start.
    const botRoom = await f.seatBotOpponent(
      (await f.create(overrides)).view,
      (await f.bot()).actorId,
    );
    const botRound = (await f.command(f.host, botRoom, { type: 'start-round' }))
      .view.roundRef!.id;
    const tick = (roundId: string) =>
      f.store.executeRoundTick({
        roundId,
        runsOpening: true,
        buildProjection: roundTickProjection(createId),
      });
    const strikes = (roundId: string) => f.sql`
      select s.ordinal, s.kind, s.actor_id, s.side
        from round_resolution_strikes s
        join round_resolution_draws d on d.id = s.draw_id
       where d.round_id = ${roundId}`;
    await tick(botRound);
    const early = await strikes(botRound);
    // Draw rows are immutable, so the automatic turn really falls due by the clock.
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOMATIC_STRIKE_DELAY_MS + 250),
    );
    await tick(botRound);
    await tick(botRound);
    await tick(humanRound);
    assert({
      given:
        'a Round waiting on a human window, and one whose automatic strike falls due after three seconds',
      should:
        'settle nothing early, then persist exactly the automatic strike, once, and leave the human window open',
      actual: {
        early: [...early],
        due: [...(await strikes(botRound))],
        human: [...(await strikes(humanRound))],
      },
      expected: {
        early: [],
        due: [
          { ordinal: 0, kind: 'automatic', actor_id: null, side: 'negative' },
        ],
        human: [],
      },
    });
  }, botAdmissionForTests);
});

test('a reveal no tick has stored reads the same from the Round, the Room and the Lobby (ISSUE-1127)', async () => {
  await withRoomRuntime(async (f) => {
    const overrides = await drawRoomOverrides(
      f,
      { kind: 'host', resolutions: lines },
      2,
    );
    const room = await f.seatBotOpponent(
      (await f.create(overrides)).view,
      (await f.bot()).actorId,
    );
    const roundId = (await f.command(f.host, room, { type: 'start-round' }))
      .view.roundRef!.id;
    const lobbyTopic = async () =>
      (
        await f.operations.list(f.outsider, { q: room.title, pageSize: 20 })
      ).rooms.find((entry) => entry.id === room.id)?.topic;
    const before = [
      (await f.operations.view(f.outsider, room.id)).topic,
      await lobbyTopic(),
    ];
    // Draw rows are immutable, so the one automatic strike falls due by the clock.
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOMATIC_STRIKE_DELAY_MS + 250),
    );
    const survivor = (await f.operations.roundView(f.outsider, roundId)).topic;
    const [stored] = await f.sql`
      select resolution from rounds where id = ${roundId}`;
    assert({
      given:
        'a draw settled by the clock, with no tick to store its resolution',
      should: 'answer one resolution from all three reads',
      actual: {
        before,
        stored: stored.resolution,
        drawn: lines.includes(survivor ?? ''),
        room: (await f.operations.view(f.outsider, room.id)).topic,
        lobby: await lobbyTopic(),
      },
      expected: {
        before: [null, null],
        stored: null,
        drawn: true,
        room: survivor,
        lobby: survivor,
      },
    });
  }, botAdmissionForTests);
});

test('a tick persisting a bot strike does not refuse the debater whose turn it opened', async () => {
  await withRoomRuntime(async (f) => {
    const overrides = await drawRoomOverrides(f, {
      kind: 'host',
      resolutions: lines,
    });
    const room = await f.seatBotOpponent(
      (await f.create(overrides)).view,
      (await f.bot()).actorId,
    );
    const roundId = (await f.command(f.host, room, { type: 'start-round' }))
      .view.roundRef!.id;
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOMATIC_STRIKE_DELAY_MS + 250),
    );
    // The form the debater sees: settled on read, before any tick persists it.
    const seen = await f.operations.roundView(f.host, roundId);
    const draw = seen.opening!.draw!;
    if (draw.visibility !== 'debater') throw new Error('A debater view');
    const struck = new Set(draw.strikes.map((s) => s.position));
    const position = draw.items.find((i) => !struck.has(i.position))!.position;
    const seat = seen.participants
      .filter(isNamedSeat)
      .find((p) => p.actorId === f.host.actorId)!;
    await f.store.executeRoundTick({
      roundId,
      runsOpening: true,
      buildProjection: roundTickProjection(createId),
    });
    const post = (ordinal: number) =>
      createRoundRuntimeOperations({
        store: f.store,
        nextSegmentId: createId,
      }).command({ kind: 'human', actorId: f.host.actorId }, roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: seen.version,
        command: {
          type: 'strike_resolution',
          participantId: seat.id,
          ordinal,
          position,
        },
      });
    await post(1);
    assert({
      given: 'a strike form rendered before the tick persisted the bot strike',
      should: 'take the strike, because its ordinal names the turn',
      actual: (await f.operations.roundView(f.host, roundId)).opening!.draw!
        .strikes.length,
      expected: 2,
    });
    await assertRejects({
      given: 'the same turn struck again from a stale form',
      should: 'still conflict on the ordinal',
      actual: () => post(1),
      code: 'CONFLICT',
    });
  }, botAdmissionForTests);
});

test('a tick starts a Round at the instant its prep ended, however late it runs', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (
      await f.command(f.host, view, {
        type: 'update-format',
        definition: {
          ...view.definition,
          configurable: {
            ...view.definition.configurable,
            preRoundPrep: { durationMs: { min: 1, max: 60_000 } },
            resolutionDraw: null,
          },
        },
        config: {
          ...view.config,
          preRoundPrep: { enabled: true, durationMs: 60_000 },
          resolutionDraw: { enabled: false },
        },
      })
    ).view;
    for (const who of [f.host, f.guest])
      view = (await f.consent(who, view, 'ready')).view;
    const roundId = (await f.command(f.host, view, { type: 'start-round' }))
      .view.roundRef!.id;
    const tick = () =>
      f.store.executeRoundTick({
        roundId,
        runsOpening: true,
        buildProjection: roundTickProjection(createId),
      });
    await tick();
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const discovered = async () => {
      const page = await f.store.readRoundMaintenanceCandidates({
        instanceId,
        limit: 1000,
      });
      return page.roundIds.includes(roundId);
    };
    const before = await discovered();
    const [during] =
      await f.sql`select status, started_at from rounds where id = ${roundId}`;
    // Prep ran long ago: created_at is the Start round anchor.
    await f.sql`update rounds set created_at = created_at - interval '90 seconds' where id = ${roundId}`;
    const due = await discovered();
    await f.sql`delete from service_instances where instance_id = ${instanceId}`;
    await tick();
    const [after] = await f.sql`select status, started_at, current_stage,
      created_at + interval '60 seconds' as prep_end from rounds where id = ${roundId}`;
    assert({
      given: 'maintenance discovery during prep, then after it ended',
      should: 'pulse an opening Round only once something in it is due',
      actual: [before, due],
      expected: [false, true],
    });
    assert({
      given: 'a tick during a 60 s prep, then one 30 s after it ended',
      should:
        'leave the opening alone, then start the Round at the prep end, not at the tick',
      actual: [
        during.status,
        during.started_at,
        after.status,
        new Date(after.started_at).getTime() ===
          new Date(after.prep_end).getTime(),
      ],
      expected: ['opening', null, 'active', true],
    });
  });
});
