import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCreateSchema } from '@daisy/protocol/room-contract';
import { unequalTemplate } from '../../../features/rooms/assembly.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { FormatTemplatePicker } from './format-template-picker';

setupRitewayBun();

/**
 * The page's own speech-order preview, outside the browse dialog (the
 * dialog previews the same draft). Its wrapper's aria-label is not exposed
 * on a plain div, so the preview is found by its list.
 */
const pagePreview = (
  view: ReturnType<typeof renderAccessible>,
  name: string,
) => {
  const outside = view
    .all('list', name, { hidden: true })
    .filter((list) => list.closest('dialog') === null);
  if (outside.length !== 1)
    throw new Error(`${outside.length} page previews named ${name}`);
  return outside[0]!;
};

/**
 * The value the native select shows on load (its option's `selected`
 * attribute). The live `selected` state is not read: happy-dom's selectedness
 * can carry over between renders into the one shared document.
 */
const selectedValue = (view: ReturnType<typeof renderAccessible>) =>
  view
    .within('combobox', 'Format')
    .all('option')
    .filter((option) => option.hasAttribute('selected'))
    .map((option) => option.getAttribute('value'))
    .join();

test('format browsing preserves native authoritative selection and unequal ordered defaults', () => {
  const view = renderAccessible(
    <FormatTemplatePicker choices={[unequalTemplate]} />,
  );
  const value = view
    .within('combobox', 'Format')
    .all('option')
    .map((option) => option.getAttribute('value'))[0];
  if (!value) throw new Error('Native format selection is missing');
  const selection = JSON.parse(value);
  const parsed = roomCreateSchema.safeParse({
    commandId: 'a'.repeat(24),
    title: 'Template proof',
    resolution: { kind: 'custom', text: 'Transit motion' },
    visibility: 'unlisted',
    selection,
  });
  const preview = pagePreview(view, 'Unequal team template speech order');
  assert({
    given:
      'a stored unequal template and server-rendered picker before hydration',
    should:
      'name the canonical preset (never a client config) and show its real seat counts and speech duration override',
    actual: [
      parsed.success,
      selection.formatVersion,
      selection.presetVersion,
      selection.config,
      view.attribute('combobox', 'Format', 'name'),
      view.within('combobox', 'Format').textContent().includes('(2v3)'),
      preview.textContent?.includes('Third negative reply (N3)'),
      preview.textContent?.includes('1:38.765'),
      view.has('dialog', undefined, { hidden: true }),
      view.has('button', 'Browse formats'),
      // A hidden element's own name is not computed; its text still says which.
      view
        .all('button', undefined, { hidden: true })
        .some(
          (button) =>
            button.hasAttribute('hidden') &&
            button.textContent === 'Browse formats',
        ),
    ],
    expected: [
      true,
      7,
      unequalTemplate.preset.version,
      undefined,
      'selection',
      true,
      true,
      true,
      true,
      false,
      true,
    ],
  });
});

test('empty format availability produces no fabricated option or browse action', () => {
  const view = renderAccessible(<FormatTemplatePicker choices={[]} />);
  assert({
    given: 'an authoritative empty catalog',
    should: 'leave native selection empty and omit a browse dialog',
    actual: [
      selectedValue(view),
      view.has('dialog', undefined, { hidden: true }),
      view.attribute('combobox', 'Format', 'name'),
    ],
    expected: ['', false, 'selection'],
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
    presetVersion: alternative.preset.version,
    competitionType: 'casual',
  });
  const view = renderAccessible(
    <FormatTemplatePicker
      choices={[unequalTemplate, alternative]}
      defaultValue={defaultValue}
    />,
  );
  assert({
    given: 'a refused selection that is not the first catalog entry',
    should:
      'keep the exact selected template in the native form and render its preview',
    actual: [
      selectedValue(view)?.includes('other-template'),
      pagePreview(view, 'Retained template speech order') !== undefined,
    ],
    expected: [true, true],
  });
});

test('a withdrawn retained template requires a new explicit native choice', () => {
  const view = renderAccessible(
    <FormatTemplatePicker
      choices={[unequalTemplate]}
      defaultValue="withdrawn"
    />,
  );
  assert({
    given: 'a retained selection absent from the current authoritative catalog',
    should:
      'select a required empty placeholder instead of silently switching templates',
    actual: [
      selectedValue(view),
      view.get('option', 'Choose an available format').hasAttribute('selected'),
    ],
    expected: ['', true],
  });
});

test('the changing selected preview is hidden before hydration', () => {
  const view = renderAccessible(
    <FormatTemplatePicker choices={[unequalTemplate]} />,
  );
  assert({
    given: 'a native form that can change format before hydration',
    should:
      'avoid showing an initial preview that cannot follow native selection changes',
    actual: [
      view.has('list', 'Unequal team template speech order'),
      pagePreview(view, 'Unequal team template speech order').closest(
        '[hidden]',
      ) !== null,
    ],
    expected: [false, true],
  });
});

test('a new room starts on Value, with standards before league rules (FMT-3)', () => {
  const standard = (formatId: string, label: string, sortOrder: number) => ({
    ...unequalTemplate,
    formatId,
    label,
    role: 'standard' as const,
    family: null,
    sortOrder,
  });
  const view = renderAccessible(
    <FormatTemplatePicker
      choices={[unequalTemplate, standard('freestyle', 'Freestyle', 3)]}
    />,
  );
  const groups = view.within('combobox', 'Format').names('group');
  assert({
    given: 'a catalog with Freestyle and a league template',
    should:
      'select Freestyle and group the Daisy standard ahead of the league rules',
    actual: [
      selectedValue(view)?.includes('"formatId":"freestyle"'),
      groups.indexOf('Daisy standard') >= 0 &&
        groups.indexOf('Daisy standard') <
          groups.indexOf('League rules · Other formats'),
    ],
    expected: [true, true],
  });
});
