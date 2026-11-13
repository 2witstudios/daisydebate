import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const rankedValue = {
  kind: 'ranked' as const,
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 1,
};

test('a casual host’s post-round call choice is kept on the Room and frozen onto its Round', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble({ postRoundCall: true });
    const plain = await f.create({}, await f.member());
    const [stored] =
      await f.sql`select post_round_call from rooms where id=${view.id}`;
    for (const seat of [f.host, f.guest])
      view = (await f.consent(seat, view, 'ready')).view;
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
    const [round] =
      await f.sql`select post_round_call from rounds where id=${roundId}`;
    const read = await f.roundView(f.guest, roundId);
    assert({
      given: 'a casual Room created with the call, and one created without',
      should:
        'say so to the Room, store it, and freeze it onto the Round two people play',
      actual: [
        view.postRoundCall,
        plain.view.postRoundCall,
        stored.post_round_call,
        round.post_round_call,
        read.postRoundCall,
      ],
      expected: [true, false, true, true, true],
    });
  });
});

test('a completed Round offers its call only while its media session lasts', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble({ postRoundCall: true });
    for (const seat of [f.host, f.guest])
      view = (await f.consent(seat, view, 'ready')).view;
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
    await f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, created_at), completed_at=clock_timestamp() where id=${roundId}`;
    const read = async () =>
      (await f.roundView(f.guest, roundId)).postRoundCall;
    const neverConnected = await read();
    await f.sql`insert into media_sessions (id, round_id, room_name) values (${createId()}, ${roundId}, ${createId()})`;
    const onCall = await read();
    await f.sql`update media_sessions set ended_at=clock_timestamp() where round_id=${roundId}`;
    const ended = await read();
    assert({
      given:
        'a completed Round with the call chosen: nobody ever connected, then a live media session, then that session ended',
      should: 'offer the call only while the session lasts',
      actual: [neverConnected, onCall, ended],
      expected: [false, true, false],
    });
  });
});

test('a ranked Room is refused the post-round call', async () => {
  await withRoomRuntime(async (f) => {
    const refusal = await f
      .create({
        selection: rankedValue,
        visibility: 'public',
        postRoundCall: true,
      })
      .catch((error: { reason?: string }) => error.reason);
    assert({
      given: 'a forged create asking a ranked Room for the call',
      should: 'refuse it',
      actual: refusal,
      expected: 'illegal-config',
    });
  });
});
