import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundAnalysis } from './round-analysis';

setupRitewayBun();

const lines = [
  {
    segment: 0,
    sequence: 0,
    speaker: 'Affirmative 1',
    text: 'Access improves.',
  },
];
const render = (view: Parameters<typeof RoundAnalysis>[0]['view']) =>
  renderToStaticMarkup(<RoundAnalysis view={view} lines={lines} />);

test('a ready analysis shows the report, quoting the transcript lines it cites', () => {
  const html = render({
    status: 'ready',
    report: { ...report, patterns: ['You drop your second contention.'] },
  });
  assert({
    given: 'a ready report citing segment 0, line 0',
    should:
      'show the summary, how to get better, the key moment with its quote and strongest reply, every skill and the patterns',
    actual: [
      'Your round analysis',
      'Only you see this',
      report.summary,
      'How to get better',
      report.improvements[0]!,
      'Key moments',
      'Affirmative 1:',
      'Access improves.',
      'Strongest reply: ',
      'Skills',
      'Cross-examination',
      '3/5',
      'Across your rounds',
      'You drop your second contention.',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'a report with no missed opportunities',
    should: 'leave that section out',
    actual: html.includes('Missed opportunities'),
    expected: false,
  });
});

test('every other state says where the analysis is or why there is none', () => {
  assert({
    given: 'pending, unavailable and locked views',
    should:
      'say it is being written, that there is none, and offer premium without any report content',
    actual: [
      render({ status: 'pending' }).includes('is being written'),
      render({ status: 'unavailable' }).includes(
        'not available for this round',
      ),
      render({ status: 'locked' }).includes('Round analysis is premium'),
      render({ status: 'locked' }).includes(report.summary),
    ],
    expected: [true, true, true, false],
  });
});

test('nothing on the card claims to decide the round', () => {
  assert({
    given: 'a ready analysis',
    should: 'never name a winner or a ballot',
    actual: /winner|ballot/i.test(render({ status: 'ready', report })),
    expected: false,
  });
});
