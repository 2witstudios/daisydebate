import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from '../../../features/rooms/assembly.test-support';
import { CreateAssemblyFields } from './create-assembly-form';

setupRitewayBun();

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
      'render editable title/topic fields and a disabled create with no mock format or judge',
    actual: [
      html.includes('name="title"'),
      html.includes('name="topic"'),
      html.includes('disabled=""'),
      html.includes('No format templates are available yet.'),
      html.includes('Placeholder'),
    ],
    expected: [true, true, true, true, false],
  });
});

test('native template selection carries the immutable revision and exact defaults', () => {
  const html = renderToStaticMarkup(
    <CreateAssemblyFields
      state={{
        values: {
          title: 'Retained title',
          topic: 'Retained topic',
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
      'show unequal teams and submit exact catalog defaults without a fresh dedupe ID or symmetric speech setting',
    actual: [
      html.includes('Unequal team template · 2 aff / 3 neg'),
      html.includes('&quot;formatVersion&quot;:7'),
      html.includes('&quot;countdownMs&quot;:444'),
      html.includes('p'.repeat(24)),
      html.includes('q'.repeat(24)),
      html.includes('Retained title'),
      html.includes('Retained topic'),
      html.includes('disabled=""'),
    ],
    expected: [true, true, true, true, false, true, true, false],
  });
});
