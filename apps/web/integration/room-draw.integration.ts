import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawRoomOverrides, strikeStanding } from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const SENTINEL = 'SENTINEL-DRAW-LINE';
const lines = [1, 2, 3, 4, 5].map((n) => `${SENTINEL} ${n}`);

test('a host-list draw strikes to one resolution, freezes evidence onto the Round and never shows a text to a spectator first', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble(
      await drawRoomOverrides(f, { kind: 'host', resolutions: lines }),
    );
    const spectatorJson = async () =>
      JSON.stringify(await f.operations.view(f.outsider, view.id));
    assert({
      given: 'a ready draw Room before its pre-round',
      should: 'keep the topic null and show the host list only to its author',
      actual: [
        view.topic,
        view.authoredDrawSource?.resolutions.length,
        (await spectatorJson()).includes(SENTINEL),
      ],
      expected: [null, 5, false],
    });

    view = (await f.command(f.host, view, { type: 'start-pre-round' })).view;
    const guestView = () => f.operations.view(f.guest, view.id);
    const drawn = await guestView();
    const [rows] = await f.sql`select
      (select count(*)::int from room_resolution_draw_items i join room_resolution_draws d on d.id = i.draw_id where d.room_id = ${view.id}) items,
      (select count(*)::int from room_resolution_draw_inputs n join room_resolution_draws d on d.id = n.draw_id where d.room_id = ${view.id}) inputs,
      (select seed from room_resolution_draws where room_id = ${view.id}) seed`;
    assert({
      given: 'the started draw',
      should:
        'persist five items and the private inputs, show debaters the texts and spectators progress only, and never deliver the seed',
      actual: [
        rows.items,
        rows.inputs,
        drawn.resolutionDraw?.visibility,
        (await f.operations.view(f.outsider, view.id)).resolutionDraw
          ?.visibility,
        (await spectatorJson()).includes(SENTINEL),
        JSON.stringify(drawn).includes(rows.seed),
      ],
      expected: [5, 1, 'debater', 'progress', false, false],
    });
    const lobby = await f.operations.list(f.outsider, {
      q: view.title,
      pageSize: 20,
    });
    const row = lobby.rooms.find((room) => room.id === view.id);
    assert({
      given: 'the Lobby during the strike',
      should: 'list the draw Room with no topic and no drawn or listed line',
      actual: [row?.topic, JSON.stringify(lobby).includes(SENTINEL)],
      expected: [null, false],
    });

    await assertRejects({
      given: 'the Affirmative striking before the Negative',
      should: 'refuse it as a conflict',
      actual: () =>
        f.command(f.host, view, {
          type: 'strike-resolution',
          ordinal: 0,
          position: 0,
        }),
      code: 'CONFLICT',
    });
    const strikers = [f.guest, f.host, f.guest, f.host];
    let current: RoomView = drawn;
    for (const [ordinal, who] of strikers.entries()) {
      const struck = await strikeStanding(f, current, who, ordinal);
      current = struck.view;
      if (ordinal === 0)
        await assertRejects({
          given: 'a stale form for the strike just made',
          should: 'refuse it as a conflict',
          actual: () =>
            f.command(f.guest, current, {
              type: 'strike-resolution',
              ordinal: 0,
              position: struck.position,
            }),
          code: 'CONFLICT',
        });
    }
    const revealed = await f.operations.view(f.outsider, view.id);
    const survivor = revealed.topic!;
    assert({
      given: 'the fourth strike',
      should:
        'reveal the survivor as the topic to everyone, still hiding the struck lines from a spectator',
      actual: [
        lines.includes(survivor),
        (await spectatorJson()).split(SENTINEL).length - 1,
      ],
      expected: [true, 1],
    });

    const launched = (
      await f.command(f.host, await f.operations.view(f.host, view.id), {
        type: 'start-round',
      })
    ).view;
    const roundId = launched.roundRef!.id;
    const [round] =
      await f.sql`select resolution, room_config_snapshot, resolution_evidence,
      (select count(*)::int from round_resolution_draw_texts where round_id = ${roundId}) texts,
      (select count(*)::int from round_draw_private_inputs where round_id = ${roundId}) inputs,
      (select count(*)::int from round_draw_seeds where round_id = ${roundId}) seeds
      from rounds where id = ${roundId}`;
    assert({
      given: 'Launch after the reveal',
      should:
        'freeze the topic, proof-only evidence, the seed, the texts and the inputs, with the snapshot naming only the list length',
      actual: [
        round.resolution === survivor,
        round.resolution_evidence.strikes.length,
        JSON.stringify(round.resolution_evidence).includes(SENTINEL),
        round.room_config_snapshot.resolutionDraw.source,
        [round.texts, round.inputs, round.seeds],
      ],
      expected: [true, 4, false, { kind: 'host', count: 5 }, [5, 1, 1]],
    });

    const refused = await Promise.allSettled([
      f.sql`update rounds set resolution_evidence = '{}'::jsonb where id = ${roundId}`,
      f.sql`delete from round_resolution_draw_texts where round_id = ${roundId}`,
      f.sql`update room_resolution_draws set commitment = commitment where room_id = ${view.id}`,
    ]);
    assert({
      given: 'writes the triggers guard',
      should: 'reject every one',
      actual: refused.map((r) => r.status),
      expected: ['rejected', 'rejected', 'rejected'],
    });
  });
});
