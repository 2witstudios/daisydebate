import { requireTestServices } from '@daisy/config';
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
