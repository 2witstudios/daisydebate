import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundSpeakerMessages } from './round-speaker';
setupRitewayBun();

const messages = (
  transcript: Parameters<typeof roundSpeakerMessages>[0]['transcript'],
) =>
  roundSpeakerMessages({
    resolution: 'Resolved: libraries matter',
    seatLabel: 'Speaker 3',
    speakers: 6,
    persona: 'Speak clearly.',
    segment: { name: 'S3', label: 'Speaker 3', durationMs: 300000 },
    transcript,
  });

test('a speaker seat is named by its label, one of the section, with no opponent side (TAB-6.18)', () => {
  const [system, user] = messages([
    {
      seatLabel: 'Speaker 1',
      segment: 'S1',
      text: 'Libraries anchor a town.',
      complete: true,
    },
    {
      seatLabel: 'Speaker 2',
      segment: 'S2',
      text: 'And yet budgets',
      complete: false,
    },
  ]);
  assert({
    given: 'the third of six speakers, after two earlier speeches',
    should:
      'name the seat by label, the section size and the missing opponent, and keep each earlier speaker distinct',
    actual: [
      system?.content.includes('Speak clearly.'),
      system?.content.includes('one of 6 speakers'),
      system?.content.includes('There is no opponent side'),
      system?.content.includes('assigned side'),
      user?.content.includes('Your seat: Speaker 3, one of 6 speakers'),
      user?.content.includes(
        '[S1; Speaker 1; complete] Libraries anchor a town.',
      ),
      user?.content.includes(
        '[S2; Speaker 2; incomplete capture] And yet budgets',
      ),
      user?.content.includes('Deliver your speech, the Speaker 3 (S3)'),
      user?.content.includes('no opposing side to answer'),
    ],
    expected: [true, true, true, false, true, true, true, true, true],
  });
});

test('a first speaker hears that nothing was said yet', () => {
  assert({
    given: 'no captured speech',
    should: 'say so rather than invent an earlier speech',
    actual: messages([])[1]?.content.includes('No captured speech yet.'),
    expected: true,
  });
});
