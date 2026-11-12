import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotSeat } from './bot-publication.test-support';
import { withGeneration } from './bot-generation.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a bot reads whether a peer’s captured words reach an instant, under its own live claim only', async () => {
  await withGeneration(async ({ fixture, target, operations }) => {
    const claim = await operations.claimWorker(target);
    const peer = await createBotSeat(fixture, target.roundId, 'negative');
    const [segment] =
      await fixture.sql`select started_at from round_segments where id=${target.segmentId}`;
    const startedMs = new Date(segment.started_at).getTime();
    const at = (ms: number) => new Date(startedMs + ms).toISOString();
    const reads = (peers: readonly string[], ms: number) =>
      operations.readPeerLine(claim.scope, claim.token, peers, at(ms));
    const none = await reads([peer.id], 0);
    // The peer's clip covers 1000 to 3000 ms of the segment.
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,clip_key,capture_track_id,capture_start_offset_ms,capture_duration_ms,capture_worker_epoch,capture_body_digest)
      values(${'u'.repeat(24)},${target.roundId},${target.segmentId},${peer.id},0,'What is your strongest example?',${'a'.repeat(64)},'TR_peer',1000,2000,1,${'b'.repeat(64)})`;
    // The bot's own line, still on air past that instant, is not the peer's words.
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,bot_phrase_id,bot_duration_ms)
      values(${'v'.repeat(24)},${target.roundId},${target.segmentId},${target.roundParticipantId},1,'Why?',true,${'p'.repeat(24)},9000)`;
    assert({
      given:
        'a peer clip ending 3000 ms into the claim’s segment, read before it exists, up to its end and past its end, beside a longer line of the bot’s own',
      should:
        'answer true only for that peer and only up to the instant the clip ends',
      actual: {
        none,
        reached: await reads([peer.id], 3000),
        past: await reads([peer.id], 3001),
        nobody: await reads([], 0),
      },
      expected: {
        none: false,
        reached: true,
        past: false,
        nobody: false,
      },
    });
    // A bot peer's words are authored, not captured: one more seat, speaking
    // a 2000 ms phrase from 5000 ms into the segment, still open and then closed.
    const bot = await createBotSeat(fixture, target.roundId, 'negative', 1);
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,bot_phrase_id,bot_duration_ms,created_at)
      values(${'w'.repeat(24)},${target.roundId},${target.segmentId},${bot.id},2,'Why is that?',false,${'q'.repeat(24)},2000,${at(5000)}::timestamptz)`;
    const stillPlaying = await reads([bot.id], 6000);
    await fixture.sql`update utterances set complete=true where id=${'w'.repeat(24)}`;
    assert({
      given:
        'a bot peer’s authored line from 5000 to 7000 ms, read while it plays, once closed, and past its end',
      should: 'count only once closed, up to the end of its audio',
      actual: {
        stillPlaying,
        closed: await reads([bot.id], 7000),
        past: await reads([bot.id], 7001),
      },
      expected: { stillPlaying: false, closed: true, past: false },
    });
    await assertRejects({
      given: 'a wrong claim token',
      should: 'refuse the read',
      actual: () =>
        operations.readPeerLine(claim.scope, 'x'.repeat(43), [peer.id], at(0)),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'an instant that is not a time',
      should: 'refuse the read',
      actual: () =>
        operations.readPeerLine(claim.scope, claim.token, [peer.id], 'soon'),
      code: 'VALIDATION',
    });
  });
});
