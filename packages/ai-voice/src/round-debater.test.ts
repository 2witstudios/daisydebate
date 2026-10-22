import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundDebaterMessages } from './round-debater';
setupRitewayBun();
test('shared Round prompt preserves each seat and incomplete captured evidence', () => {
  const messages = roundDebaterMessages({
    resolution: 'Resolved: public libraries should stay open later',
    side: 'negative',
    slot: 2,
    persona: 'Speak clearly and respectfully.',
    segment: {
      name: 'CX1',
      label: 'Cross examination',
      type: 'cross_ex',
      durationMs: 30000,
    },
    transcript: [
      {
        side: 'affirmative',
        slot: 1,
        segment: 'AC',
        text: 'Libraries support night workers.',
        complete: true,
      },
      {
        side: 'negative',
        slot: 1,
        segment: 'NC',
        text: 'Staffing costs',
        complete: false,
      },
      {
        side: 'negative',
        slot: 2,
        segment: 'CX1',
        text: 'What cost evidence supports this?',
        complete: true,
      },
    ],
  });
  assert({
    given: 'multiple real seats including an incomplete capture',
    should:
      'retain seat distinctions and limitations without guessing an asker or human identity',
    actual: [
      messages.length,
      messages[0]?.content.includes('Speak clearly'),
      messages[1]?.content.includes('affirmative seat 1'),
      messages[1]?.content.includes('negative seat 1'),
      messages[1]?.content.includes('incomplete'),
      messages[1]?.content.includes('negative seat 2'),
      messages[1]?.content.includes('free cross-examination'),
    ],
    expected: [2, true, true, true, true, true, true],
  });
});

test('shared constructive and final speech prompts preserve canonical speech goals', () => {
  const prompt = (name: string) =>
    roundDebaterMessages({
      resolution: 'Resolved: libraries matter',
      side: 'affirmative',
      slot: 0,
      persona: 'Speak clearly.',
      segment: { name, label: name, type: 'speech', durationMs: 300000 },
      transcript: [],
    })[1]!.content;
  assert({
    given: 'canonical constructive and final rebuttal slots',
    should:
      'preserve the specific argument and voting obligations in shared-Round prompts',
    actual: [
      prompt('AC').includes('two or three clear contentions'),
      prompt('2AR').includes('two or three clear voting issues'),
    ],
    expected: [true, true],
  });
});
