import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { StudentsLive } from './students-live';

setupRitewayBun();

const card = {
  roundId: 'r'.repeat(24),
  href: `/rounds/${'r'.repeat(24)}/room`,
  title: 'Thursday scrimmage',
  resolution: 'Cities should ban cars from their downtown cores.',
  ranked: true,
  line: 'maya.okafor vs jules_park · Speeches · 1AR',
};

test('Your students, live', () => {
  const view = renderAccessible(<StudentsLive cards={[card]} />);
  const section = view.within('region', 'Your students, live');
  const text = section.textContent();
  assert({
    given: "a linked coach's student debating live",
    should:
      'list the Round with its title, resolution and debaters, and link its live room',
    actual: [
      section.has('heading', 'Your students, live', { level: 2 }),
      section.has('heading', 'Thursday scrimmage', { level: 3 }),
      text.includes(card.resolution),
      text.includes(card.line),
      section.attribute('link', 'Watch Thursday scrimmage', 'href'),
      section.text('link', 'Watch Thursday scrimmage'),
      text.includes('Ranked'),
      renderAccessible(<StudentsLive cards={[{ ...card, ranked: false }]} />)
        .textContent()
        .includes('Casual'),
    ],
    expected: [true, true, true, true, card.href, 'Watch', true, true],
  });
  assert({
    given: 'nobody to show',
    should: 'render nothing',
    actual: StudentsLive({ cards: [] }),
    expected: null,
  });
});
