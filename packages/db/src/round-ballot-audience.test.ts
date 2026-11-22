import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eventBallotForAudience } from './round-ballot-audience';
import type { Ballot } from '@daisy/protocol/ballot-schema';
setupRitewayBun();
const ballot: Ballot = {
  rubricVersion: 'speaker-10@2',
  winner: 'affirmative',
  scores: { affirmative: 8, negative: 6 },
  speakerRanks: [['s1'], ['s2']],
  reason: 'Unscreened original',
  feedback: { affirmative: 'Original feedback' },
  citations: {
    affirmative: { turn: 'AC', note: 'Original private reference' },
  },
};
const parts = ['decision', 'scores', 'reason', 'feedback'] as const;
test('event ballot written release requires an actual valid screened copy', () => {
  const screenings = [
    null,
    { status: 'pending', releasedText: null },
    { status: 'held', releasedText: { reason: 'Not approved' } },
    { status: 'clear', releasedText: null },
    { status: 'clear', releasedText: { reason: 7 } },
    {
      status: 'clear',
      releasedText: {
        reason: 'Screened',
        feedback: { affirmative: 'Released feedback' },
      },
    },
  ];
  const competition = {
    rubricVersion: ballot.rubricVersion,
    winner: ballot.winner,
    scores: ballot.scores,
    speakerRanks: ballot.speakerRanks,
  };
  assert({
    given:
      'all parts opened but missing, pending, held, absent, malformed and valid screened text',
    should:
      'retain competition and show only the approved copy, with no original text or citation fallback',
    actual: screenings.map((s) =>
      eventBallotForAudience(ballot, { parts, unreleased: false }, s),
    ),
    expected: [
      ...screenings.slice(0, -1).map(() => competition),
      {
        ...competition,
        reason: 'Screened',
        feedback: { affirmative: 'Released feedback' },
      },
    ],
  });
});
test('event parts open independently and current official authority is explicit', () => {
  assert({
    given:
      'no opened parts, scores only, reason only and current unreleased authority',
    should:
      'never disclose a winner through scores or unscreened words through a reason release',
    actual: [
      eventBallotForAudience(ballot, { parts: [], unreleased: false }, null),
      eventBallotForAudience(
        ballot,
        { parts: ['scores'], unreleased: false },
        null,
      ),
      eventBallotForAudience(
        ballot,
        { parts: ['reason'], unreleased: false },
        { status: 'clear', releasedText: { reason: 'Screened' } },
      ),
      eventBallotForAudience(ballot, { parts, unreleased: true }, null),
    ],
    expected: [
      { rubricVersion: ballot.rubricVersion },
      {
        rubricVersion: ballot.rubricVersion,
        scores: ballot.scores,
        speakerRanks: ballot.speakerRanks,
      },
      { rubricVersion: ballot.rubricVersion, reason: 'Screened' },
      ballot,
    ],
  });
});
