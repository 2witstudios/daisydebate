import { assert, setupRitewayBun, test } from 'riteway/bun';
import { screenBallotContacts } from './ballot-contact-screening';
setupRitewayBun();
test('submission contact screening v1', () => {
  for (const contact of [
    'judge@example.org',
    '+1 (312) 555-0123',
    'https://example.org/path',
    'www.example.org',
    'example.org/path',
    '@debate_judge',
  ]) {
    const original = {
      reason: `Good argument. Contact ${contact}`,
      feedback: { speaker: 'Clear delivery' },
    };
    assert({
      given: `a held ballot containing ${contact}`,
      should: 'hold the whole written copy and name the actual rule set',
      actual: screenBallotContacts(original, 'hold'),
      expected: {
        ruleSetVersion: 'contact-v1',
        status: 'held',
        releasedText: null,
      },
    });
    assert({
      given: `redaction selected for ${contact}`,
      should:
        'remove contact details while preserving other fields and the original',
      actual: [screenBallotContacts(original, 'off'), original.reason],
      expected: [
        {
          ruleSetVersion: 'contact-v1',
          status: 'clear',
          releasedText: {
            reason: 'Good argument. Contact [contact removed]',
            feedback: { speaker: 'Clear delivery' },
          },
        },
        `Good argument. Contact ${contact}`,
      ],
    });
  }
  assert({
    given: 'contact in feedback with a clean reason',
    should: 'screen every written field',
    actual: screenBallotContacts(
      {
        reason: 'Clear argument',
        feedback: { speaker: 'Email me at a@b.org' },
      },
      'hold',
    ).status,
    expected: 'held',
  });
  for (const original of [
    {},
    { reason: '', feedback: {} },
    { reason: 'Strong argument with 3 examples and a score of 27.5.' },
  ]) {
    assert({
      given: 'empty or unflagged written fields',
      should: 'produce a clear copy from the rules',
      actual: screenBallotContacts(original, 'hold'),
      expected: {
        ruleSetVersion: 'contact-v1',
        status: 'clear',
        releasedText: original,
      },
    });
  }
});
