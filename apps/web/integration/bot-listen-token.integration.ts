import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { mediaDependencies } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

/** The LiveKit video grant a join token carries (decoded, never trusted for authority). */
const videoGrant = (token: string) =>
  JSON.parse(
    Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
  ) as {
    sub: string;
    video: Record<string, unknown>;
  };
const refused = (work: () => Promise<unknown>) =>
  work().then(
    () => false,
    () => true,
  );

test("the bot seat's listen grant subscribes, never publishes, is hidden and binds no seat (ISSUE-764)", async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const media = createRoundMediaOperations(mediaDependencies(f));
    const listen = await media.botListenToken(claim.scope, claim.token);
    const grant = videoGrant(listen.token);
    const [session] =
      await f.sql`select id, room_name from media_sessions where round_id=${roundId}`;
    const bound =
      await f.sql`select identity from media_participants where session_id=${session!.id}`;
    assert({
      given: 'a live bot claim asking to hear its media session',
      should:
        'sign a hidden, subscribe-only grant for that one room, under an identity no seat is bound to',
      actual: {
        room: grant.video.room,
        canSubscribe: grant.video.canSubscribe,
        canPublish: grant.video.canPublish,
        canPublishData: grant.video.canPublishData,
        hidden: grant.video.hidden,
        unbound: !bound.some(
          (row: { identity: string }) => row.identity === grant.sub,
        ),
      },
      expected: {
        room: session!.room_name,
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
        hidden: true,
        unbound: true,
      },
    });
    const staleClaim = await refused(() =>
      media.botListenToken(claim.scope, `${claim.token}x`),
    );
    await f.sql`update media_sessions set ended_at=clock_timestamp() where id=${session!.id}`;
    const ended = await refused(() =>
      media.botListenToken(claim.scope, claim.token),
    );
    assert({
      given:
        'a claim token that is not the live one, then an ended media session',
      should:
        'refuse to sign either: the hearing lives no longer than its claim and session',
      actual: { staleClaim, ended },
      expected: { staleClaim: true, ended: true },
    });
  }, botControlOptions);
});
