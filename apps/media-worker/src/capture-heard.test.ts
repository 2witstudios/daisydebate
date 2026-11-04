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
  let nowMs = 0;
  const reporter = createHeardReporter({
    nowMs: () => nowMs,
    heard: async (track) => {
      if (refuse.has(track.trackId)) throw new Error('lost');
      reports.push(
        `${track.epoch}/${track.segmentId}/${track.roundParticipantId}/${track.trackId}`,
      );
    },
  });
  return {
    reporter,
    reports,
    pass: (ms: number) => {
      nowMs += ms;
    },
  };
}
const signal = new AbortController().signal;

test("capture reports each seat's track it starts hearing, once (ISSUE-514-r2)", async () => {
  const { reporter, reports } = harness();
  reporter.started({ identity: 'bot-id', trackId: 'TR_bot' });
  reporter.started({ identity: 'human-id', trackId: 'TR_human' });
  await reporter.report(open, 3, signal);
  await reporter.report(open, 3, signal);
  assert({
    given: 'a bot track and a human track that capture started reading',
    should: 'report each seat for its track once, in the open segment',
    actual: reports,
    expected: ['3/seg/bot-seat/TR_bot', '3/seg/human-seat/TR_human'],
  });
});

test('a lost report is sent again; a closed track reports nothing', async () => {
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
    expected: ['1/null/bot-seat/TR_bot'],
  });
});

test('capture reports a track before the clock, and again while it reads it', async () => {
  const { reporter, reports, pass } = harness();
  reporter.started({ identity: 'human-id', trackId: 'TR_human' });
  await reporter.report(state(null), 1, signal);
  assert({
    given: 'a track capture reads during a countdown, no segment open',
    should: 'report it with no segment, so the speech can start knowing',
    actual: reports,
    expected: ['1/null/human-seat/TR_human'],
  });
  await reporter.report(state(null), 1, signal);
  pass(10_000);
  await reporter.report(open, 1, signal);
  assert({
    given: 'the same track, soon after, then past its report life',
    should: 'stay quiet, then report again against the open segment',
    actual: reports,
    expected: ['1/null/human-seat/TR_human', '1/seg/human-seat/TR_human'],
  });
});
