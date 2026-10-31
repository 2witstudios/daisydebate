import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from '../../../features/rooms/assembly.test-support';
import { CreateAssemblyFields } from './create-assembly-form';

setupRitewayBun();

test('creation presents format first and a complete progressively enhanced editor', () => {
  const html = renderToStaticMarkup(
    <CreateAssemblyFields
      state={{ values: {} }}
      pending={false}
      commandId={'m'.repeat(24)}
      choices={[{ ...unequalTemplate, formatId: 'value', role: 'standard' }]}
    />,
  );
  assert({
    given: 'a room creator with an authoritative Value preset',
    should:
      'offer four format choices, four resolution methods and editable settings without a topic-first form',
    actual: [
      ['freestyle', 'policy', 'value', 'custom'].every(
        (format) =>
          html.includes(`name="format"`) && html.includes(`value="${format}"`),
      ),
      html.includes('Policy res'),
      html.includes('Value res'),
      html.includes('Points of information (POI)'),
      html.includes('name="duration.segment.0"'),
      html.includes('name="duration.preRound"'),
      html.includes('value="add-affirmative"'),
      html.includes('name="resolutionMethod"'),
      html.includes('name="topic"'),
    ],
    expected: [true, true, true, false, false, false, false, true, false],
  });
});

test('an empty catalog cannot submit a fabricated template', () => {
  const html = renderToStaticMarkup(
    <CreateAssemblyFields
      state={{ values: {} }}
      pending={false}
      commandId={'m'.repeat(24)}
      choices={[]}
    />,
  );
  assert({
    given: 'no authoritative catalog choices',
    should:
      'render the room name and a disabled create with no fabricated resolution or format',
    actual: [
      html.includes('name="title"'),
      html.includes('name="topic"'),
      html.includes('disabled=""'),
      html.includes('No formats are available yet.'),
      html.includes('Placeholder'),
    ],
    expected: [true, false, true, true, false],
  });
});

test('native template selection carries the immutable revision and exact defaults', () => {
  const html = renderToStaticMarkup(
    <CreateAssemblyFields
      state={{
        values: {
          title: 'Retained title',
          customResolution: 'Retained topic',
          commandId: 'p'.repeat(24),
        },
      }}
      pending={false}
      commandId={'q'.repeat(24)}
      choices={[unequalTemplate]}
    />,
  );
  assert({
    given:
      'a producer template and a refused draft with a retained dedupe identity',
    should:
      'retain the template basis, exact timings, unequal seats and dedupe ID',
    actual: [
      html.includes('2v3'),
      html.includes('value="test-unequal-template@7@5"'),
      html.includes('value="1:38.765"'),
      html.includes('p'.repeat(24)),
      html.includes('q'.repeat(24)),
      html.includes('Retained title'),
      html.includes('Retained topic'),
      html.includes('name="duration.preRound"'),
    ],
    expected: [true, true, true, true, false, true, true, true],
  });
});
test('a new Room cannot be made private while no invite path exists', () => {
  const html = renderToStaticMarkup(
    <CreateAssemblyFields
      state={{ values: {} }}
      pending={false}
      commandId={'q'.repeat(24)}
      choices={[unequalTemplate]}
    />,
  );
  assert({
    given: 'the create form',
    should: 'offer unlisted and public, not private (ISSUE-443)',
    actual: [
      html.includes('value="unlisted"'),
      html.includes('value="public"'),
      html.includes('value="private"'),
    ],
    expected: [true, true, false],
  });
});
