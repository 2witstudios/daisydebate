import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withBotPublication } from './bot-publication.test-support';
import { mediaTestStore, mediaTestTick } from './media-session.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('media reconciliation requires an actual current generation lease independently of bot presence', async () => {
  await withBotPublication(async ({ fixture, target, operations }) => {
    await fixture.insert('media_sessions', {
      id: createId(),
      round_id: target.roundId,
      room_name: createId(),
    });
    const store = mediaTestStore(fixture.sql);
    const eligible = async () =>
      (await store.readMediaSession({
        roundId: target.roundId,
        admits: admitsPrincipalAccess,
        buildProjection: mediaTestTick,
      }))!.participants.find((seat) => seat.id === target.roundParticipantId)!
        .eligible;
    const before = await eligible();
    await operations.claimWorker(target);
    const current = await eligible();
    await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 millisecond' where round_id=${target.roundId}`;
    const expired = await eligible();
    assert({
      given:
        'the same canonical bot seat before claim, during an actual current claim and after durable lease expiry',
      should:
        'expose publication authority only while its exact scoped generation lease is live',
      actual: [before, current, expired],
      expected: [false, true, false],
    });
    await operations.claimWorker(target);
    await fixture.sql`update agent_runs set ended_at=clock_timestamp() where round_participant_id=${target.roundParticipantId} and ended_at is null`;
    assert({
      given: 'an ended real generation run despite a live publication claim',
      should: 'close media authority without waiting for browser presence',
      actual: await eligible(),
      expected: false,
    });
  });
});
