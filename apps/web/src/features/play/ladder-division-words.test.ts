import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  lockedLadderLine,
  rankedDivisionReason,
  seatOnOtherLadder,
} from './ladder-division-words';

setupRitewayBun();

test('lockedLadderLine', () => {
  assert({
    given:
      'a youth member under the locked Open ladder, and an adult under Youth',
    should:
      'state the 18 edge and the bounded carry for the youth member, and that judging Youth stays open for the adult',
    actual: [lockedLadderLine('open'), lockedLadderLine('youth')],
    expected: [
      'Open ladders are for members 18 and over. Turn 18 mid-season and you stay on Youth until the season ends, for up to a year; then Open starts, and your Youth rating stays in your history.',
      'Youth – Freestyle is for members under 18. You can still judge Youth Rounds.',
    ],
  });
});

test('seat refusal words', () => {
  assert({
    given: 'an adult refused a Youth Room’s debater seat',
    should: 'name the seat’s ladder and audience and the adult’s own ladder',
    actual: seatOnOtherLadder('youth', 'open'),
    expected: {
      title: 'That seat is for a debater under 18.',
      body: 'This is a Youth – Freestyle ranked Room, so its debater seats are for members under 18. You can judge it, or play on Open – Freestyle.',
    },
  });
  assert({
    given: 'the generic refusal of a cross-ladder claim',
    should: 'name both ladders and who each is for',
    actual: rankedDivisionReason,
    expected:
      'That debater seat is on the other ladder: Open – Freestyle is for members 18 and over, Youth – Freestyle for members under 18. You can still judge it.',
  });
});
