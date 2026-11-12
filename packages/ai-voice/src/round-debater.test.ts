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
      side: 'negative',
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
      messages[1]?.content.includes('your side asks'),
    ],
    expected: [2, true, true, true, true, true, true],
  });
});

test('a cross-examination prompt names the role the seat plays', () => {
  const prompt = (side: 'affirmative' | 'negative') =>
    roundDebaterMessages({
      resolution: 'Resolved: libraries matter',
      side: 'affirmative',
      slot: 0,
      persona: 'Speak clearly.',
      segment: {
        name: 'CX1',
        label: 'Cross-examination',
        type: 'cross_ex',
        side,
        durationMs: 30000,
      },
      transcript: [],
    })[1]!.content;
  assert({
    given: 'the asking side, then the other side',
    should: 'tell the bot to ask, then to answer and ask nothing',
    actual: [
      prompt('affirmative').includes('your side asks'),
      prompt('negative').includes('the other side asks'),
      prompt('negative').includes('ask nothing of your own'),
    ],
    expected: [true, true, true],
  });
});

test('shared constructive and final speech prompts preserve canonical speech goals', () => {
  const prompt = (name: string) =>
    roundDebaterMessages({
      resolution: 'Resolved: libraries matter',
      side: 'affirmative',
      slot: 0,
      persona: 'Speak clearly.',
      segment: {
        name,
        label: name,
        type: 'speech',
        side: 'affirmative',
        durationMs: 300000,
      },
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

test('an asking seat whose question met silence is told to press it', () => {
  const prompt = (side: 'affirmative' | 'negative', unanswered: boolean) =>
    roundDebaterMessages({
      resolution: 'Resolved: libraries matter',
      side: 'affirmative',
      slot: 0,
      persona: 'Speak clearly.',
      segment: {
        name: 'CX1',
        label: 'Cross-examination',
        type: 'cross_ex',
        side,
        durationMs: 30000,
      },
      unanswered,
      transcript: [],
    })[1]!.content;
  assert({
    given:
      'the asking seat with an unanswered question, with an answered one, and a respondent',
    should:
      'say the question went unanswered only to the asking seat it happened to',
    actual: [
      prompt('affirmative', true).includes('went unanswered'),
      prompt('affirmative', false).includes('went unanswered'),
      prompt('negative', true).includes('went unanswered'),
    ],
    expected: [true, false, false],
  });
});
