import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { Bracket } from './bracket';
setupRitewayBun();
test('a four-entry fixture keeps every ranked entry in its own row', () => {
  const markup = renderToStaticMarkup(
    <Bracket
      bracket={{
        stages: [
          {
            id: 'section-final',
            name: 'Section final',
            state: 'done',
            time: null,
            note: null,
            fixtures: [
              {
                fixtureId: 'fixture',
                room: null,
                watch: null,
                entries: ['Amber', 'Blue', 'Cedar', 'Dawn'].map((name, i) => ({
                  entryId: name,
                  name,
                  seed: null,
                  outcome: { won: null, rank: i + 1, ballotsWon: null },
                })),
              },
            ],
          },
        ],
      }}
    />,
  );
  assert({
    given:
      'a section with four actual retained ranks and no invented seeds or ballot counts',
    should: 'render all four names and all four ranks',
    actual: [
      'Amber',
      'Blue',
      'Cedar',
      'Dawn',
      'Rank 1',
      'Rank 2',
      'Rank 3',
      'Rank 4',
    ].map((text) => markup.includes(text)),
    expected: Array.from({ length: 8 }, () => true),
  });
});
