import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { StudentsLive } from './students-live';

setupRitewayBun();

const card = {
  roundId: 'r'.repeat(24),
  href: `/rounds/${'r'.repeat(24)}/room`,
  title: 'Thursday scrimmage',
  resolution: 'Cities should ban cars from their downtown cores.',
  line: 'maya.okafor vs jules_park · Speeches · 1AR',
};

test('Your students, live', () => {
  const html = renderToStaticMarkup(<StudentsLive cards={[card]} />);
  assert({
    given: "a linked coach's student debating live",
    should:
      'list the Round with its title, resolution and debaters, and link its live room',
    actual: [
      html.includes('Your students, live'),
      html.includes('Thursday scrimmage'),
      html.includes(card.resolution),
      html.includes(card.line),
      html.includes(`href="${card.href}"`),
      html.includes('>Watch</a>'),
    ],
    expected: [true, true, true, true, true, true],
  });
  assert({
    given: 'nobody to show',
    should: 'render nothing',
    actual: renderToStaticMarkup(<StudentsLive cards={[]} />),
    expected: '',
  });
});
