import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { twoSides } from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';
import { type SeatDraw } from '@daisy/protocol/seat-draw';
import { OpeningSides, speakerLabel } from './opening-sides';

setupRitewayBun();

const seat = (
  id: string,
  actorId: string,
  label: string,
  role: 'affirmative' | 'negative',
  slot: number,
) => ({
  id,
  actorId,
  label,
  kind: 'human',
  seat: { kind: 'side', side: role, slot },
});

const view = {
  id: 'round00000000000000000001',
  participants: [
    seat('pana', 'ana', 'Ana', 'affirmative', 0),
    seat('pbo', 'bo', 'Bo', 'affirmative', 1),
    seat('pcy', 'cy', 'Cy', 'negative', 0),
    seat('pdee', 'dee', 'Dee', 'negative', 1),
    {
      id: 'pjudge',
      seat: { kind: 'judge', slot: 0 },
      kind: 'human',
      anonymous: true,
    },
  ],
  rules: { sides: twoSides },
} as unknown as RoundView;

const sides = (over: Partial<SeatDraw> = {}): SeatDraw => ({
  algorithm: 'daisy-draw-v1/seats',
  commitment: '0'.repeat(64),
  coin: 'swapped',
  teamOneSide: 'negative',
  moved: [],
  ...over,
});

const moved: SeatDraw['moved'] = [
  {
    participantId: 'pdee',
    open: ['position'],
    from: { role: 'affirmative', slot: 0 },
    to: { role: 'negative', slot: 1 },
  },
];

const render = (draw: SeatDraw, actorId: string) =>
  renderToStaticMarkup(
    <OpeningSides view={view} sides={draw} actorId={actorId} />,
  );

describe('OpeningSides', () => {
  test('a seated debater after a coin flip', () => {
    const html = render(sides(), 'cy');
    assert({
      given: 'a coin flip and a Negative debater viewing',
      should: 'name the flip and tell them their side',
      actual: [
        html.includes('Coin flip'),
        html.includes('You&#x27;re Negative'),
      ],
      expected: [true, true],
    });
  });

  test('everyone else after a coin flip', () => {
    const html = render(sides(), 'watcher');
    assert({
      given: 'a coin flip and a viewer with no debater seat',
      should: 'name who is Affirmative',
      actual: html.includes('Ana and Bo are Affirmative'),
      expected: true,
    });
  });

  test('side cards', () => {
    const html = render(sides({ moved }), 'watcher');
    assert({
      given: 'a debater whose position was open',
      should: 'list each side with speaking positions and mark the open seat',
      actual: [
        html.includes('Affirmative'),
        html.includes('Negative'),
        html.includes('Dee'),
        html.includes('2nd speaker · was ?'),
        (html.match(/was \?/g) ?? []).length,
        html.includes('Anonymous') || html.includes('pjudge'),
      ],
      expected: [true, true, true, true, 1, false],
    });
  });

  test('fixed sides with an open seat', () => {
    const html = render(sides({ coin: null, moved }), 'ana');
    assert({
      given: 'sides the Room fixed and a placed open seat',
      should: 'show the placements without the coin line',
      actual: [html.includes('Coin flip'), html.includes('was ?')],
      expected: [false, true],
    });
  });

  test('nothing drawn', () => {
    assert({
      given: 'sides the Room fixed and no open seat',
      should: 'render nothing',
      actual: render(sides({ coin: null, moved: [] }), 'ana'),
      expected: '',
    });
  });
});

describe('speakerLabel', () => {
  test('speaking positions', () => {
    assert({
      given: 'zero-based slots',
      should: 'read as speaking positions',
      actual: [0, 1, 2, 3].map(speakerLabel),
      expected: ['1st speaker', '2nd speaker', '3rd speaker', '4th speaker'],
    });
  });
});
