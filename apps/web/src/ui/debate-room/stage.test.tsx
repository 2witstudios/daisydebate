import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Debater } from './round';
import { Tile } from './stage';

setupRitewayBun();

const debater = {
  id: 'a',
  name: 'Ada',
  initials: 'A',
  side: 'aff',
  rating: null,
} satisfies Debater;

test('a tile keeps its part in the phase at phone width', () => {
  const html = (state: string) =>
    renderToStaticMarkup(
      <Tile debater={debater} you={false} state={state} look="small" />,
    );
  assert({
    given: 'a tile whose pill hides at narrow width',
    should: 'name its state in the caption shown only at that width',
    actual: [
      html('Speaking').includes(
        '<span class="hidden max-narrow:inline"> · speaking</span>',
      ),
      html('').includes('max-narrow:inline'),
      renderToStaticMarkup(
        <Tile
          debater={debater}
          you={false}
          state="Speaking"
          look="small"
          caption
        />,
      ).includes('<span> · speaking</span>'),
    ],
    expected: [true, false, true],
  });
});
