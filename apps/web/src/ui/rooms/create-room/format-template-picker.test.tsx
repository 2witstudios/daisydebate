import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCreateSchema } from '@daisy/protocol';
import { unequalTemplate } from '../../../features/rooms/assembly.test-support';
import { FormatTemplatePicker } from './format-template-picker';

setupRitewayBun();

test('format browsing preserves native authoritative selection and unequal ordered defaults', () => {
  const html = renderToStaticMarkup(
    <FormatTemplatePicker choices={[unequalTemplate]} />,
  );
  const option = html.match(/<option value="([^"]+)"/);
  if (!option) throw new Error('Native format selection is missing');
  const selection = JSON.parse(
    option[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
  );
  const parsed = roomCreateSchema.safeParse({
    commandId: 'a'.repeat(24),
    title: 'Template proof',
    topic: 'Transit motion',
    visibility: 'unlisted',
    selection,
  });
  assert({
    given:
      'a stored unequal template and server-rendered picker before hydration',
    should:
      'retain native canonical defaults and show its real seat counts and speech duration override',
    actual: [
      parsed.success,
      selection.formatVersion,
      selection.config,
      html.includes('name="selection"'),
      html.includes('2 aff / 3 neg'),
      html.includes('Third negative reply'),
      html.includes('98.765 s'),
      html.includes('<dialog'),
      html.includes('hidden=""'),
    ],
    expected: [
      true,
      7,
      unequalTemplate.defaultConfig,
      true,
      true,
      true,
      true,
      true,
      true,
    ],
  });
});

test('empty format availability produces no fabricated option or browse action', () => {
  const html = renderToStaticMarkup(<FormatTemplatePicker choices={[]} />);
  assert({
    given: 'an authoritative empty catalog',
    should: 'leave native selection empty and omit a browse dialog',
    actual: [
      html.includes('<option value="" selected=""'),
      html.includes('<dialog'),
      html.includes('name="selection"'),
    ],
    expected: [true, false, true],
  });
});

test('a retained refused selection previews its own exact defaults rather than the first catalog entry', () => {
  const alternative = {
    ...unequalTemplate,
    formatId: 'other-template',
    label: 'Retained template',
  };
  const defaultValue = JSON.stringify({
    kind: 'catalog',
    formatId: alternative.formatId,
    formatVersion: alternative.formatVersion,
    length: 'full',
    competitionType: 'casual',
    config: alternative.defaultConfig,
  });
  const html = renderToStaticMarkup(
    <FormatTemplatePicker
      choices={[unequalTemplate, alternative]}
      defaultValue={defaultValue}
    />,
  );
  const selected = html.match(/<option[^>]*selected=""[^>]*>/)?.[0];
  assert({
    given: 'a refused selection that is not the first catalog entry',
    should:
      'keep the exact selected template in the native form and render its preview',
    actual: [
      selected?.includes('other-template'),
      html.includes('Retained template speech order'),
    ],
    expected: [true, true],
  });
});

test('a withdrawn retained template requires a new explicit native choice', () => {
  const html = renderToStaticMarkup(
    <FormatTemplatePicker
      choices={[unequalTemplate]}
      defaultValue="withdrawn"
    />,
  );
  const selected = html.match(/<option[^>]*selected=""[^>]*>/)?.[0];
  assert({
    given: 'a retained selection absent from the current authoritative catalog',
    should:
      'select a required empty placeholder instead of silently switching templates',
    actual: [
      selected?.includes('value=""'),
      html.includes('Choose an available format'),
    ],
    expected: [true, true],
  });
});

test('the changing selected preview is hidden before hydration', () => {
  const html = renderToStaticMarkup(
    <FormatTemplatePicker choices={[unequalTemplate]} />,
  );
  assert({
    given: 'a native form that can change format without JavaScript',
    should:
      'avoid showing an initial preview that cannot follow native selection changes',
    actual: html.includes(
      '<div hidden="" aria-label="Selected format preview">',
    ),
    expected: true,
  });
});
