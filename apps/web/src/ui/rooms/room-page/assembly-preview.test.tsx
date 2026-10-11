import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblySchedule, AssemblySummary } from './assembly-preview';

setupRitewayBun();

test('saved schedule preserves the pinned asymmetric order and precise durations', () => {
  const html = renderToStaticMarkup(
    <AssemblySchedule view={assemblySnapshot} />,
  );
  assert({
    given:
      'the saved N3 then A1 rules with an independent millisecond override',
    should:
      'render the actual order, slots and precise duration without a symmetric template',
    actual: [
      html.indexOf('Third negative reply') <
        html.indexOf('Affirmative opening'),
      html.includes('Negative 3'),
      html.includes('1 min 38.765 sec'),
      html.includes('test-unequal-template'),
      html.includes('revision 7'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('saved settings summary includes configured preparation, interactions and countdown', () => {
  const html = renderToStaticMarkup(
    <AssemblySummary view={assemblySnapshot} />,
  );
  assert({
    given: 'saved independent timing, preparation and interaction settings',
    should: 'summarize acknowledged values using readable exact units',
    actual: [
      '5 min 21 sec',
      '14 min 47 sec',
      '0.444 sec',
      '1.234 sec',
      'Before the round',
      'Preparation per side',
      'Yielding',
      'Return unused time',
    ].every((value) => html.includes(value)),
    expected: true,
  });
});
