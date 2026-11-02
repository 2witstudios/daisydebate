import { requireTestServices } from '@daisy/config';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
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
    const humanRound = (await f.command(cast.host, humans, { type: 'start-round' }))
      .view.roundRef!.id;
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
    const roundId = (await f.command(f.host, view, { type: 'start-round' })).view
      .roundRef!.id;
    const tick = () =>
      f.store.executeRoundTick({
        roundId,
        buildProjection: roundTickProjection(createId),
      });
    await tick();
    const [during] = await f.sql`select status, started_at from rounds where id = ${roundId}`;
    // Prep ran long ago: created_at is the Start round anchor.
    await f.sql`update rounds set created_at = created_at - interval '90 seconds' where id = ${roundId}`;
    await tick();
    const [after] = await f.sql`select status, started_at, current_stage,
      created_at + interval '60 seconds' as prep_end from rounds where id = ${roundId}`;
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
