import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { speechName } from '../../features/debate-room/vocabulary';
import { seatLabel } from '../rooms/room-page/assembly-controls';
import { completed, speeches } from './result.test-support';
import {
  resultBallots,
  resultCoaching,
  transcriptSections,
} from './result-view';

setupRitewayBun();

describe('resultBallots()', () => {
  test('released ballots', () => {
    assert({
      given: 'a completed Round with a human and a voided AI ballot',
      should:
        'title each by order and kind of judge, never by who judged, and mark the voided one',
      actual: resultBallots(completed).map(({ title, author, voided }) => ({
        title,
        author,
        voided,
      })),
      expected: [
        {
          title: 'Ballot 1 · Human judge',
          author: 'Human judge',
          voided: false,
        },
        { title: 'Ballot 2 · AI judge', author: 'AI judge', voided: true },
      ],
    });
  });
  test('the feedback heading names the judge as a reader says it', () => {
    assert({
      given: 'a human ballot and an AI ballot',
      should: 'say "the human judge" and keep "AI" in capitals',
      actual: resultBallots(completed).map(
        ({ feedbackTitle }) => feedbackTitle,
      ),
      expected: [
        'Feedback for you from the human judge',
        'Feedback for you from the AI judge',
      ],
    });
  });
  test('an unfinished Round', () => {
    assert({
      given: 'a Round still in progress',
      should: 'release no ballots',
      actual: resultBallots({
        ...completed,
        round: { ...completed.round, status: 'active' },
      }),
      expected: [],
    });
  });
});

describe('resultCoaching()', () => {
  const coaching = (value: (typeof completed)['coaching']) =>
    resultCoaching({ ...completed, coaching: value });
  test('every state', () => {
    assert({
      given: 'ready, in-ballot, pending, unavailable and no coaching',
      should:
        'show the text, or say where it is, that it is coming, or that there is none',
      actual: [
        coaching({ status: 'ready', text: 'Answer the cost turn first.' }),
        coaching({ status: 'in-ballot' }),
        coaching({ status: 'pending' }),
        coaching({ status: 'unavailable' }),
        coaching(null),
      ],
      expected: [
        { kind: 'ready', text: 'Answer the cost turn first.' },
        {
          kind: 'note',
          text: 'Your coaching is the AI judge’s feedback for you on its ballot above.',
        },
        {
          kind: 'note',
          text: 'Your coaching is being written. Reload this page in a minute.',
        },
        {
          kind: 'note',
          text: 'AI coaching is not available for this round.',
        },
        null,
      ],
    });
  });
});

describe('transcriptSections()', () => {
  test('lines grouped by speech', () => {
    const heading = (index: number) => {
      const speech = speeches[index]!;
      return `${speechName(speech)} · ${seatLabel(speech.side, speech.slot)}`;
    };
    assert({
      given: 'two frozen lines in two played speeches',
      should:
        'group them by speech in played order, named as the room names them, each line with its speaker and partial lines marked',
      actual: transcriptSections(completed).map(({ heading, lines }) => ({
        heading,
        lines: lines.map(({ speaker, text, partial }) => ({
          speaker,
          text,
          partial,
        })),
      })),
      expected: [
        {
          heading: heading(0),
          lines: [
            { speaker: 'Sam Reyes', text: 'Access improves.', partial: false },
          ],
        },
        {
          heading: heading(1),
          lines: [
            {
              speaker: 'Practice bot',
              text: 'Costs displace services',
              partial: true,
            },
          ],
        },
      ],
    });
  });
  test('no transcript', () => {
    assert({
      given: 'a reader who was not seated',
      should: 'have no sections',
      actual: transcriptSections({ ...completed, transcript: null }),
      expected: [],
    });
  });
});
