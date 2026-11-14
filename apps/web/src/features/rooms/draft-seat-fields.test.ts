import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fourTeams } from '@daisy/protocol';
import {
  seatFieldValues,
  seatsFromFields,
  segmentSeatValues,
  speakFromFields,
} from './draft-seat-fields';

setupRitewayBun();

const fourTeamSeats = {
  sides: [...fourTeams],
  seats: {
    sides: {
      opening_government: 2,
      opening_opposition: 2,
      closing_government: 2,
      closing_opposition: 2,
    },
    speakers: 0,
    judges: 3,
    moderators: 0 as const,
  },
};

test('the editor’s seat fields round-trip every declared side', () => {
  const values = seatFieldValues(fourTeamSeats);
  assert({
    given: 'a four-team format with a panel of three',
    should: 'name one count per side and read the same seats back',
    actual: [
      values['seat.side.closing_opposition'],
      seatsFromFields(values, fourTeamSeats.sides),
    ],
    expected: ['2', fourTeamSeats.seats],
  });
});

test('an edited segment keeps its format’s speak rights unless its type or seat moved', () => {
  const source = {
    key: 'CX',
    label: 'Cross-examination',
    type: 'cross_ex' as const,
    speak: {
      rights: 'several' as const,
      seats: [
        { kind: 'side' as const, side: 'negative', slot: 0 },
        { kind: 'side' as const, side: 'affirmative', slot: 0 },
      ],
      lead: { kind: 'side' as const, side: 'negative', slot: 0 },
    },
    defaultDurationMs: 180_000,
  };
  assert({
    given:
      'the untouched segment, a moved asker, a new speech and an open floor',
    should:
      'keep the source’s rights, open the floor to everyone, give a speech one seat, and read an empty seat as no lead',
    actual: [
      speakFromFields({ type: 'cross_ex', side: 'negative', slot: 0 }, source),
      speakFromFields(
        { type: 'cross_ex', side: 'affirmative', slot: 0 },
        source,
      ),
      speakFromFields({ type: 'speech', side: 'speaker', slot: 2 }, undefined),
      speakFromFields({ type: 'open', side: '', slot: 0 }, undefined),
      segmentSeatValues({ rights: 'all', lead: null }),
    ],
    expected: [
      source.speak,
      {
        rights: 'all',
        lead: { kind: 'side', side: 'affirmative', slot: 0 },
      },
      { rights: 'one', seat: { kind: 'speaker', slot: 2 } },
      { rights: 'all', lead: null },
      { side: '', slot: '0' },
    ],
  });
});
