import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { AssemblyDetailsFields } from './assembly-details';
import {
  commandUnavailable,
  roomEditFields,
} from '../../../features/rooms/command-answer';

setupRitewayBun();

/**
 * The hidden fields the details post with (their type, revision and command
 * id), which no role states. The fields render without their form, so they
 * are read from the rendered fields themselves.
 */
const hiddenFields = (view: AccessibleView) =>
  [
    ...view
      .get('textbox', 'Room name')
      .ownerDocument.body.querySelectorAll('input[type="hidden"]'),
  ].map(
    (field) => `${field.getAttribute('name')}=${field.getAttribute('value')}`,
  );

test('refused detail drafts preserve values and the submitted revision', () => {
  const view = renderAccessible(
    <AssemblyDetailsFields
      view={{ ...assemblySnapshot, version: 4 }}
      commandId="fresh-command"
      state={{
        values: {
          title: 'Typed title',
          topic: 'Typed topic',
          expectedVersion: '3',
          commandId: 'previous-command',
        },
        error: 'The room changed.',
      }}
      pending={false}
    />,
  );
  assert({
    given: 'typed details based on a stale revision',
    should:
      'keep their intent and offer explicit recovery rather than silently adopting the new revision',
    actual: [
      view.attribute('textbox', 'Room name', 'value'),
      view.get('textbox', 'Resolution').textContent,
      hiddenFields(view).includes('expectedVersion=3'),
      hiddenFields(view).includes('commandId=previous-command'),
      view.has('link', 'Review latest room'),
    ],
    expected: ['Typed title', 'Typed topic', true, true, true],
  });
});

test('non-host details remain visible but cannot submit an edit', () => {
  const view = renderAccessible(
    <AssemblyDetailsFields
      view={{
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
      }}
      commandId="unused-command"
      state={{ values: {}, error: undefined }}
      pending={false}
    />,
  );
  assert({
    given: 'a canonical non-editable projection',
    should: 'show stored details, mark inputs read-only and omit Save',
    actual: [
      view.attribute('textbox', 'Room name', 'value') === 'Persisted room',
      ['Room name', 'Resolution'].every((field) =>
        view.get('textbox', field).hasAttribute('readonly'),
      ),
      view.textContent().includes('Only the host can edit this room.'),
      view.has('button', 'Save room'),
    ],
    expected: [true, true, true, false],
  });
});

test('the details form keeps who can join as saved (ADR 0145)', () => {
  const view = renderAccessible(
    <AssemblyDetailsFields
      view={{ ...assemblySnapshot, visibility: 'unlisted' }}
      commandId="fresh-command"
      state={{ values: {}, error: undefined }}
      pending={false}
    />,
  );
  assert({
    given: 'an unlisted Room’s details form in Edit settings',
    should: 'post the saved visibility unchanged, with no choice of its own',
    actual: [
      hiddenFields(view).filter((field) => field.startsWith('visibility=')),
      view.count('combobox', /who can join/i),
      view.count('radio'),
    ],
    expected: [['visibility=unlisted'], 0, 0],
  });
});

test('a details save whose answer was lost is offered again as a new command on the latest room', () => {
  const lost = new FormData();
  for (const [name, value] of Object.entries({
    type: 'update-details',
    commandId: 'previous-command',
    expectedVersion: '3',
    title: 'Typed title',
    topic: 'Typed topic',
    visibility: 'public',
  }))
    lost.set(name, value);
  const view = renderAccessible(
    <AssemblyDetailsFields
      view={{ ...assemblySnapshot, version: 4 }}
      commandId="fresh-command"
      state={roomEditFields(commandUnavailable(lost))}
      pending={false}
    />,
  );
  assert({
    given:
      'details saved at version three whose answer was lost, and the latest room at version four',
    should:
      'keep what was typed, take the version and command identifier from the latest room, and say the save may have landed',
    actual: [
      view.attribute('textbox', 'Room name', 'value'),
      view.get('textbox', 'Resolution').textContent,
      hiddenFields(view).includes('expectedVersion=4'),
      hiddenFields(view).includes('commandId=fresh-command'),
      hiddenFields(view).includes('commandId=previous-command'),
      view.textContent().includes('These changes may have been saved.'),
      view.has('link', 'Review latest room'),
    ],
    expected: ['Typed title', 'Typed topic', true, true, false, true, true],
  });
});
