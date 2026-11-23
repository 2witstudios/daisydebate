import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
  renderAccessible(
    <RoundAnalysis roundId={'r'.repeat(24)} view={view} lines={lines} />,
  );

test('a ready analysis shows the report, quoting the transcript lines it cites', () => {
  const text = render({
    status: 'ready',
    report: { ...report, patterns: ['You drop your second contention.'] },
  }).textContent();
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
    ].filter((part) => !text.includes(part)),
    expected: [],
  });
  assert({
    given: 'a report with no missed opportunities',
    should: 'leave that section out',
    actual: text.includes('Missed opportunities'),
    expected: false,
  });
});

test('every other state says where the analysis is or why there is none', () => {
  assert({
    given: 'pending, unavailable, locked and fair-use views',
    should:
      'say it is being written or that there is none, show the upgrade panel in place without report content, and name fair use without a number',
    actual: [
      render({ status: 'pending' }).textContent().includes('is being written'),
      render({ status: 'unavailable' })
        .textContent()
        .includes('not available for this round'),
      render({ status: 'locked' })
        .textContent()
        .includes('You’ve used your free analysis'),
      render({ status: 'locked' }).attribute('link', 'Get Premium', 'href'),
      render({ status: 'locked' }).has('button', 'Not now'),
      render({ status: 'locked' }).textContent().includes(report.summary),
      render({ status: 'fair-use' }).textContent().includes('fair-use ceiling'),
      /\d/.test(render({ status: 'fair-use' }).textContent()),
    ],
    expected: [true, true, true, '/premium', true, false, true, false],
  });
});

test('nothing on the card claims to decide the round', () => {
  assert({
    given: 'a ready analysis',
    should: 'never name a winner or a ballot',
    actual: /winner|ballot/i.test(
      render({ status: 'ready', report }).textContent(),
    ),
    expected: false,
  });
});

test('a requestable analysis renders a native mutation form with no authority inputs', () => {
  assert({
    given: 'free and included analysis allowances',
    should:
      'offer an explicit POST form that needs no client script or actor fields',
    actual: (['free', 'included'] as const).map((allowance) => {
      const view = render({ status: 'requestable', allowance });
      const submit = view.get(
        'button',
        'Request analysis',
      ) as HTMLButtonElement;
      const form = submit.form;
      return [
        form?.getAttribute('method'),
        form?.getAttribute('action'),
        submit.getAttribute('type'),
        [...(form?.elements ?? [])].filter((field) => field.tagName === 'INPUT')
          .length,
        view
          .textContent()
          .includes(
            allowance === 'free'
              ? 'one free analysis'
              : 'Included with your access',
          ),
      ];
    }),
    expected: (['free', 'included'] as const).map(() => [
      'post',
      `/api/rounds/${'r'.repeat(24)}/round-analysis`,
      'submit',
      0,
      true,
    ]),
  });
});
