import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { twoSides } from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';
import { type SeatDraw } from '@daisy/protocol/seat-draw';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
  renderAccessible(<OpeningSides view={view} sides={draw} actorId={actorId} />);

describe('OpeningSides', () => {
  test('a seated debater after a coin flip', () => {
    const view = render(sides(), 'cy');
    assert({
      given: 'a coin flip and a Negative debater viewing',
      should: 'name the flip and tell them their side',
      actual: [
        view
          .within('region', "You're Negative")
          .textContent()
          .includes('Coin flip'),
        view.has('heading', "You're Negative", { level: 2 }),
      ],
      expected: [true, true],
    });
  });

  test('everyone else after a coin flip', () => {
    const view = render(sides(), 'watcher');
    assert({
      given: 'a coin flip and a viewer with no debater seat',
      should: 'name who is Affirmative',
      actual: view.has('heading', 'Ana and Bo are Affirmative', { level: 2 }),
      expected: true,
    });
  });

  test('side cards', () => {
    const view = render(sides({ moved }), 'watcher');
    const seats = view.all('listitem').map((seat) => seat.textContent ?? '');
    assert({
      given: 'a debater whose position was open',
      should: 'list each side with speaking positions and mark the open seat',
      actual: [
        view.has('heading', 'Affirmative', { level: 3 }),
        view.has('heading', 'Negative', { level: 3 }),
        seats.filter((seat) => seat.includes('was ?')),
        seats.length,
        /Anonymous|pjudge/.test(view.textContent()),
      ],
      expected: [true, true, ['Dee2nd speaker · was ?'], 4, false],
    });
  });

  test('fixed sides with an open seat', () => {
    const text = render(sides({ coin: null, moved }), 'ana').textContent();
    assert({
      given: 'sides the Room fixed and a placed open seat',
      should: 'show the placements without the coin line',
      actual: [text.includes('Coin flip'), text.includes('was ?')],
      expected: [false, true],
    });
  });

  test('nothing drawn', () => {
    assert({
      given: 'sides the Room fixed and no open seat',
      should: 'render nothing',
      actual: render(sides({ coin: null, moved: [] }), 'ana').textContent(),
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
