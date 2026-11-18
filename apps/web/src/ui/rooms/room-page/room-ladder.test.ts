import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RatingDivision, RoomView } from '@daisy/protocol';
import {
  competitionWords,
  judgeSeatLine,
  mixedLadderNotice,
  otherLadderSeat,
  roomLadder,
  rowDivision,
  startRoundLabel,
} from './room-ladder';

setupRitewayBun();

type Participant = RoomView['participants'][number];

const ranked = (ladder: RoomView['ladder']) => ({
  competitionType: 'ranked' as const,
  ladder,
});
const casual = { competitionType: 'casual' as const, ladder: null };

const debater = (
  label: string,
  division: RatingDivision | null,
  side: string,
  kind: 'human' | 'bot' = 'human',
): Participant => ({
  id: `${label[0]}`.repeat(24),
  actorId: `${label[0]}`.repeat(24),
  label,
  consentVersion: 0,
  kind,
  seat: { kind: 'side', side, slot: 0 },
  teamOpen: false,
  positionOpen: false,
  rating: null,
  division,
  needsReady: true,
  ready: 'ready',
  eligible: true,
});

const judge: Participant = {
  ...debater('tessa.k', null, 'affirmative'),
  seat: { kind: 'judge', slot: 0 },
};

describe('roomLadder and competitionWords', () => {
  test('a ranked Room carries its ladder; a casual one none', () => {
    assert({
      given: 'a Youth, an unset and a mixed ranked Room, and a casual one',
      should:
        'carry each ranked ladder, and say a mixed one is ranked but playing casual',
      actual: [
        [roomLadder(ranked('youth')), competitionWords(ranked('youth'))],
        [roomLadder(ranked('unset')), competitionWords(ranked('unset'))],
        [roomLadder(ranked('mixed')), competitionWords(ranked('mixed'))],
        [roomLadder(casual), competitionWords(casual)],
      ],
      expected: [
        ['youth', 'Ranked'],
        ['unset', 'Ranked'],
        ['mixed', 'Ranked, playing casual'],
        [null, 'Casual'],
      ],
    });
  });
});

describe('startRoundLabel', () => {
  test('a mixed Room starts a casual Round, and says so', () => {
    assert({
      given: 'a mixed ranked Room, an Open ranked Room and a casual one',
      should: 'label Start casual round only for the mixed Room',
      actual: [
        startRoundLabel(ranked('mixed')),
        startRoundLabel(ranked('open')),
        startRoundLabel(casual),
      ],
      expected: ['Start casual round', 'Start round', 'Start round'],
    });
  });
});

describe('rowDivision', () => {
  test('rows name ladders only while the debaters mix them', () => {
    const youth = { division: 'youth' as const };
    assert({
      given:
        'a Youth debater in a mixed Room, in a Youth Room, and in a casual Room',
      should: 'name their ladder only in the mixed Room',
      actual: [
        rowDivision(ranked('mixed'), youth),
        rowDivision(ranked('youth'), youth),
        rowDivision(casual, youth),
      ],
      expected: ['youth', null, null],
    });
  });
});

describe('judgeSeatLine', () => {
  test('a Youth Room says anyone can judge it', () => {
    assert({
      given: 'a Youth, an Open and a casual Room',
      should: 'say anyone can judge under the Youth Room’s judge seat only',
      actual: [
        judgeSeatLine(ranked('youth')),
        judgeSeatLine(ranked('open')),
        judgeSeatLine(casual),
      ],
      expected: ['Anyone can judge a Youth Round.', null, null],
    });
  });
});

describe('otherLadderSeat', () => {
  test('a debater seat on the viewer’s other ladder says whose it is', () => {
    assert({
      given: 'an adult viewing a Youth Room and a youth member an Open Room',
      should:
        'name the seat’s audience and ladder, and offer judging or the viewer’s own ladder',
      actual: [
        otherLadderSeat(ranked('youth'), 'open'),
        otherLadderSeat(ranked('open'), 'youth')?.title,
      ],
      expected: [
        {
          title: 'That seat is for a debater under 18.',
          body: 'This is a Youth – Freestyle ranked Room, so its debater seats are for members under 18. You can judge it, or play on Open – Freestyle.',
        },
        'That seat is for a debater 18 and over.',
      ],
    });
  });

  test('a seat the viewer may take, or a viewer with no ladder', () => {
    assert({
      given:
        'their own ladder, an unset and a mixed Room, a casual Room, and a viewer with no ladder',
      should: 'name no other ladder',
      actual: [
        otherLadderSeat(ranked('youth'), 'youth'),
        otherLadderSeat(ranked('unset'), 'open'),
        otherLadderSeat(ranked('mixed'), 'open'),
        otherLadderSeat(casual, 'open'),
        otherLadderSeat(ranked('open'), null),
      ],
      expected: [null, null, null, null, null],
    });
  });
});

describe('mixedLadderNotice', () => {
  test('names each debater and their ladder, never an age', () => {
    assert({
      given: 'a ranked Room seating a Youth and an Open debater and a judge',
      should:
        'say the Round plays casual, who plays which ladder, and how to keep it ranked',
      actual: mixedLadderNotice({
        ...ranked('mixed'),
        participants: [
          debater('sam.reyes', 'youth', 'affirmative'),
          debater('devon_r', 'open', 'negative'),
          judge,
        ],
      }),
      expected: {
        title: 'This Round will be casual',
        body: 'The debaters are on different ladders: sam.reyes plays Youth – Freestyle and devon_r plays Open – Freestyle. A ranked Round needs every debater on one ladder, so this one plays casual and no ratings change.',
        remedy:
          'To keep it ranked, seat two debaters from the same ladder before you start.',
      },
    });
  });

  test('more debaters, one without a ladder', () => {
    const notice = mixedLadderNotice({
      ...ranked('mixed'),
      participants: [
        debater('ana', 'open', 'affirmative'),
        debater('ben', 'open', 'affirmative'),
        debater('cy', null, 'negative'),
      ],
    });
    assert({
      given: 'three ranked debaters, one with no age on record',
      should: 'list each, say who has no ladder, and ask for every debater',
      actual: [notice?.body.split('. ')[0], notice?.remedy],
      expected: [
        'The debaters are on different ladders: ana plays Open – Freestyle, ben plays Open – Freestyle and cy has no ladder',
        'To keep it ranked, seat every debater from the same ladder before you start.',
      ],
    });
  });

  test('no notice unless the Room plays casual', () => {
    assert({
      given: 'a Youth ranked Room and a casual Room',
      should: 'tell the host nothing',
      actual: [
        mixedLadderNotice({ ...ranked('youth'), participants: [] }),
        mixedLadderNotice({ ...casual, participants: [] }),
      ],
      expected: [null, null],
    });
  });
});
