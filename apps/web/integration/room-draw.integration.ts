import {
  captureRule,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  drawRoomOverrides,
  strikeCommand,
  strikeStanding,
} from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const SENTINEL = 'SENTINEL-DRAW-LINE';
const lines = [1, 2, 3, 4, 5].map((n) => `${SENTINEL} ${n}`);

test('Start round creates the draw on the Round, strikes reach one resolution, and no text leaks', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble(
      await drawRoomOverrides(f, { kind: 'host', resolutions: lines }),
    );
    const spectatorJson = async () =>
      JSON.stringify(await f.operations.view(f.outsider, view.id));
    assert({
      given: 'a ready draw Room before Start round',
      should: 'keep the topic null and show the host list only to its author',
      actual: [
        view.topic,
        view.authoredDrawSource?.resolutions.length,
        (await spectatorJson()).includes(SENTINEL),
      ],
      expected: [null, 5, false],
    });

    const started = (await f.command(f.host, view, { type: 'start-round' }))
      .view;
    const roundId = started.roundRef!.id;
    const roundJson = async (viewer: typeof f.host) =>
      JSON.stringify(await f.roundView(viewer, roundId));
    const drawn = await f.roundView(f.guest, roundId);
    const [rows] = await f.sql`select
      (select count(*)::int from round_resolution_draw_items i join round_resolution_draws d on d.id = i.draw_id where d.round_id = ${roundId}) items,
      (select count(*)::int from round_resolution_draw_texts where round_id = ${roundId}) texts,
      (select count(*)::int from round_draw_private_inputs where round_id = ${roundId}) inputs,
      (select seed from round_draw_seeds where round_id = ${roundId}) seed,
      (select status from rounds where id = ${roundId}) status,
      (select resolution from rounds where id = ${roundId}) resolution`;
    const spectated = await f.roundView(f.outsider, roundId);
    assert({
      given: 'the Round a Start round creates',
      should:
        'hold five items, their texts and the private inputs, in its opening with no resolution, showing debaters the texts and everyone else progress',
      actual: [
        rows.items,
        rows.texts,
        rows.inputs,
        rows.status,
        rows.resolution,
        drawn.opening?.draw?.visibility,
        spectated.opening?.draw?.visibility,
        spectated.topic,
        (await roundJson(f.outsider)).includes(SENTINEL),
        JSON.stringify(drawn).includes(rows.seed),
      ],
      expected: [
        5,
        5,
        1,
        'opening',
        null,
        'debater',
        'progress',
        null,
        false,
        false,
      ],
    });
    const ballotRead = await f.store.readRoundBallot({
      caller: f.outsider,
      roundId,
      authorize: () => true,
      authorizeTranscript: () => false,
      readOpening: readRoundOpening,
      decideWaitingOn: roundWaitingOn,
      captureRule,
    });
    assert({
      given:
        'a viewer reaching the Round through its ballot read, as a judge does',
      should: 'carry strike progress and no drawn line',
      actual: [
        ballotRead.round.opening?.draw?.visibility,
        JSON.stringify(ballotRead).includes(SENTINEL),
      ],
      expected: ['progress', false],
    });
    const lobby = await f.operations.list(f.outsider, {
      q: view.title,
      pageSize: 20,
    });
    const row = lobby.rooms.find((room) => room.id === view.id);
    assert({
      given: 'the Lobby during the strike',
      should: 'list the Room as live with no topic and no drawn or listed line',
      actual: [
        row?.topic,
        row?.roundRef?.status,
        JSON.stringify(lobby).includes(SENTINEL),
      ],
      expected: [null, 'opening', false],
    });

    await assertRejects({
      given: 'the Affirmative striking before the Negative',
      should: 'refuse it as a conflict',
      actual: () => strikeCommand(f, roundId, f.host, 0, 0),
      code: 'CONFLICT',
    });
    const strikers = [f.guest, f.host, f.guest, f.host];
    for (const [ordinal, who] of strikers.entries()) {
      const struck = await strikeStanding(f, roundId, who, ordinal);
      if (ordinal === 0)
        await assertRejects({
          given: 'a stale form for the strike just made',
          should: 'refuse it as a conflict',
          actual: () => strikeCommand(f, roundId, f.guest, 0, struck.position),
          code: 'CONFLICT',
        });
    }
    const revealed = await f.roundView(f.outsider, roundId);
    const survivor = revealed.topic!;
    const [round] = await f.sql`select resolution, status, started_at,
      room_config_snapshot, resolution_evidence
      from rounds where id = ${roundId}`;
    assert({
      given: 'the fourth strike, with no prep to follow',
      should:
        'set the resolution and proof-only evidence once, and start the Round at that strike',
      actual: [
        lines.includes(survivor),
        round.resolution === survivor,
        round.status,
        round.started_at !== null,
        round.resolution_evidence.strikes.length,
        JSON.stringify(round.resolution_evidence).includes(SENTINEL),
        round.room_config_snapshot.resolutionDraw.source,
      ],
      expected: [
        true,
        true,
        'active',
        true,
        4,
        false,
        { kind: 'host', count: 5 },
      ],
    });

    // ISSUE-705: until the Round ends, its read carries the topic and no draw text.
    assert({
      given: 'the active Round read by its debater and by a spectator',
      should:
        'carry the debated resolution once and no other drawn line, and no audit envelope',
      actual: [
        (await roundJson(f.host)).split(SENTINEL).length - 1,
        (await roundJson(f.outsider)).split(SENTINEL).length - 1,
        (await f.roundView(f.outsider, roundId)).resolutionAudit,
      ],
      expected: [1, 1, null],
    });

    const refused = await Promise.allSettled([
      f.sql`update rounds set resolution_evidence = '{}'::jsonb where id = ${roundId}`,
      f.sql`delete from round_resolution_draw_texts where round_id = ${roundId}`,
      f.sql`update round_resolution_draws set commitment = commitment where round_id = ${roundId}`,
      f.sql`delete from round_resolution_strikes where draw_id in (select id from round_resolution_draws where round_id = ${roundId})`,
      f.sql`delete from round_resolution_draw_items where draw_id in (select id from round_resolution_draws where round_id = ${roundId})`,
      f.sql`delete from round_resolution_draws where round_id = ${roundId}`,
    ]);
    assert({
      given: 'writes the triggers guard, including direct deletes of a draw',
      should: 'reject every one',
      actual: refused.map((r) => r.status),
      expected: Array.from({ length: 6 }, () => 'rejected'),
    });
  });
});

test('a seated debater who is no longer eligible is not offered the strike', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble(
      await drawRoomOverrides(f, { kind: 'host', resolutions: lines }),
    );
    const { roundRef } = (
      await f.command(f.host, view, { type: 'start-round' })
    ).view;
    const roundId = roundRef!.id;
    const canStrike = async () =>
      (
        await f.store.readLaunchedRound(
          roundId,
          f.guest,
          () => true,
          readRoundOpening,
          roundWaitingOn,
        )
      ).opening?.canStrike;
    const eligible = await canStrike();
    await f.sql`update users set deleted_at = statement_timestamp() where id = ${f.guest.userId}`;
    assert({
      given: 'the debater on turn, before and after their account ends',
      should: 'offer the strike only while the command would take it',
      actual: [eligible, await canStrike()],
      expected: [true, false],
    });
  });
});
