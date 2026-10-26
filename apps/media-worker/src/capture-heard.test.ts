import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createHeardReporter } from './capture-heard';
import type { CaptureState } from './capture-history';
setupRitewayBun();

const state = (segment: { id: string; endedAt: string | null } | null) =>
  ({
    segment,
    participants: [
      { roundParticipantId: 'bot-seat', kind: 'bot', identity: 'bot-id' },
      { roundParticipantId: 'human-seat', kind: 'human', identity: 'human-id' },
    ],
  }) as unknown as CaptureState;
const open = state({ id: 'seg', endedAt: null });
function harness(refuse = new Set<string>()) {
  const reports: string[] = [];
  const reporter = createHeardReporter({
    heard: async (track) => {
      if (refuse.has(track.trackId)) throw new Error('lost');
      reports.push(
        `${track.epoch}/${track.segmentId}/${track.roundParticipantId}/${track.trackId}`,
      );
    },
  });
  return { reporter, reports };
}
const signal = new AbortController().signal;

test("capture reports each bot track it starts hearing once, and never a human's (ISSUE-514-r2)", async () => {
  const { reporter, reports } = harness();
  reporter.started({ identity: 'bot-id', trackId: 'TR_bot' });
  reporter.started({ identity: 'human-id', trackId: 'TR_human' });
  await reporter.report(open, 3, signal);
  await reporter.report(open, 3, signal);
  assert({
    given: 'a bot track and a human track that capture started reading',
    should: 'report the bot seat for its track once, in the open segment',
    actual: reports,
    expected: ['3/seg/bot-seat/TR_bot'],
  });
});

test('a lost report is sent again; a closed track or a closed segment reports nothing', async () => {
  const refuse = new Set(['TR_bot']);
  const { reporter, reports } = harness(refuse);
  reporter.started({ identity: 'bot-id', trackId: 'TR_bot' });
  await reporter.report(open, 1, signal);
  refuse.clear();
  await reporter.report(state({ id: 'seg', endedAt: 'x' }), 1, signal);
  await reporter.report(open, 1, signal);
  reporter.started({ identity: 'bot-id', trackId: 'TR_gone' });
  reporter.closed('TR_gone');
  await reporter.report(open, 1, signal);
  assert({
    given: 'a refused report, a closed segment, then a track that closed',
    should:
      'resend the refused report once the segment is open, and never report the closed track',
    actual: reports,
    expected: ['1/seg/bot-seat/TR_bot'],
  });
});
