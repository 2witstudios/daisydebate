import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  freestyleChoice,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { CreateAssemblyFields } from './create-assembly-form';

setupRitewayBun();

/**
 * The names the fields post under, and the hidden fields' values: the native
 * form's payload, which no role states. The fields render without their form,
 * so the payload is read from the rendered fields themselves.
 */
const payload = (view: AccessibleView) => {
  const fields = [
    ...view
      .get('button', 'Create room')
      .ownerDocument.body.querySelectorAll('[name]'),
  ];
  return {
    names: fields.map((field) => field.getAttribute('name')),
    hidden: Object.fromEntries(
      fields
        .filter((field) => field.getAttribute('type') === 'hidden')
        .map((field) => [
          field.getAttribute('name'),
          field.getAttribute('value'),
        ]),
    ),
    values: [
      ...view
        .get('button', 'Create room')
        .ownerDocument.body.querySelectorAll('[value]'),
    ].map((field) => field.getAttribute('value')),
  };
};

test('creation presents format first and a complete progressively enhanced editor', () => {
  const view = renderAccessible(
    <CreateAssemblyFields
      memberDivision="open"
      lobbyChoice={null}
      state={{ values: {}, error: undefined }}
      pending={false}
      commandId={'m'.repeat(24)}
      choices={[freestyleChoice]}
    />,
  );
  const { names, values } = payload(view);
  const format = view.within('radiogroup', 'Format').all('radio');
  assert({
    given: 'a room creator with the authoritative Freestyle preset',
    should:
      'offer Freestyle or Custom, Strike or Custom wording, and editable settings without a topic-first form',
    actual: [
      format.map(
        (radio) =>
          `${radio.getAttribute('name')}=${radio.getAttribute('value')}`,
      ),
      ['policy', 'value'].some((format) => values.includes(format)),
      view.textContent().includes('Policy res') ||
        view.textContent().includes('Value res'),
      view.textContent().includes('Points of information (POI)'),
      view.count('textbox', 'Time, minutes and seconds'),
      view.count('textbox', 'Before the round, minutes and seconds'),
      view.has('button', 'Add affirmative speech'),
      view.attribute('combobox', 'Resolution', 'name'),
      names.includes('topic'),
    ],
    expected: [
      ['format=freestyle', 'format=custom'],
      false,
      false,
      false,
      0,
      0,
      false,
      'resolutionMethod',
      false,
    ],
  });
});

test('an empty catalog cannot submit a fabricated template', () => {
  const view = renderAccessible(
    <CreateAssemblyFields
      memberDivision="open"
      lobbyChoice={null}
      state={{ values: {}, error: undefined }}
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
      view.attribute('textbox', 'Room name', 'name'),
      payload(view).names.includes('topic'),
      view.get('button', 'Create room').hasAttribute('disabled'),
      view.textContent().includes('No formats are available yet.'),
      view.textContent().includes('Placeholder'),
    ],
    expected: ['title', false, true, true, false],
  });
});

test('native template selection carries the immutable revision and exact defaults', () => {
  const view = renderAccessible(
    <CreateAssemblyFields
      memberDivision="open"
      lobbyChoice={null}
      state={{
        values: {
          title: 'Retained title',
          customResolution: 'Retained topic',
          commandId: 'p'.repeat(24),
        },
        error: undefined,
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
      view.textContent().includes('2v3'),
      payload(view).hidden.basis,
      view
        .all('textbox', 'Time, minutes and seconds')
        .map((field) => field.getAttribute('value'))[0],
      payload(view).hidden.commandId,
      view.attribute('textbox', 'Room name', 'value'),
      view.get('textbox', 'Custom resolution').textContent,
      view.attribute(
        'textbox',
        'Before the round, minutes and seconds',
        'name',
      ),
    ],
    expected: [
      true,
      'test-unequal-template@7@5',
      '1:38.765',
      'p'.repeat(24),
      'Retained title',
      'Retained topic',
      'duration.preRound',
    ],
  });
});
test('a new Room cannot be made private while no invite path exists', () => {
  const view = renderAccessible(
    <CreateAssemblyFields
      memberDivision="open"
      lobbyChoice={null}
      state={{ values: {}, error: undefined }}
      pending={false}
      commandId={'q'.repeat(24)}
      choices={[unequalTemplate]}
    />,
  );
  const offered = view
    .within('combobox', /^Who can join/)
    .all('option')
    .map((option) => option.getAttribute('value'));
  assert({
    given: 'the create form',
    should: 'offer unlisted and public, not private (ISSUE-443)',
    actual: [
      offered.includes('unlisted'),
      offered.includes('public'),
      offered.includes('private'),
    ],
    expected: [true, true, false],
  });
});
