import { serverMessageSchema } from '@daisy/protocol';
import { expect, openPage, test } from './fixtures';
import { coachedYouthRound, openFloor, postFloorMessage } from './youth-coach';

/**
 * YLS-12 (ADR 0158) with realtime up: a youth debater's school coach watching
 * their student's live Youth Round is admitted by the realtime server to its
 * floor chat, through `daisy_round_linked_adult_actors`, so the student's
 * message arrives on the coach's open page as an observed snapshot, and the
 * chat stays read-only for them.
 */
export function testYouthCoachFloorLive() {
  test("a coach sees their student's floor message arrive live in a Youth Round", async ({
    browser,
    context,
  }) => {
    const seeded = await coachedYouthRound(browser, context);
    try {
      const channelId = await openFloor(
        seeded.student.request,
        seeded.round.roundId,
      );
      const coach = await openPage(context, 'the watching coach');
      const snapshots: number[] = [];
      coach.on('websocket', (socket) =>
        socket.on('framereceived', (frame) => {
          let raw: unknown;
          try {
            raw = JSON.parse(String(frame.payload));
          } catch {
            return;
          }
          const parsed = serverMessageSchema.safeParse(raw);
          if (
            parsed.success &&
            parsed.data.type === 'observation.snapshot' &&
            parsed.data.resource.kind === 'channel-messages' &&
            parsed.data.resource.id === channelId
          )
            snapshots.push(parsed.data.contentRevision);
        }),
      );
      await coach.goto(`/rounds/${seeded.round.roundId}/room`);
      await expect(coach.getByText('Watching', { exact: true })).toBeVisible();
      const floor = coach.getByRole('region', { name: 'Round floor chat' });
      await expect(
        floor.getByText('This Round chat is read-only.'),
      ).toBeVisible();
      // The realtime server admitted the coach: the floor's first snapshot.
      await expect.poll(() => snapshots.length).toBeGreaterThan(0);
      const said = `Mind the clock ${seeded.tag}`;
      expect(
        await postFloorMessage(
          seeded.student.request,
          seeded.round.roundId,
          channelId,
          said,
        ),
      ).toBe(200);
      await expect(
        floor
          .getByRole('list', { name: 'Floor messages' })
          .getByText(said, { exact: true }),
      ).toBeVisible();
      await expect(
        floor.getByText('This Round chat is unavailable.'),
      ).toHaveCount(0);
      await expect(floor.getByRole('textbox')).not.toBeEditable();
      await expect(
        floor.getByRole('button', { name: 'Send message' }),
      ).toBeDisabled();
    } finally {
      await seeded.student.close();
      await seeded.stop();
    }
  });
}
