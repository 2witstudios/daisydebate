import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblyDetailsFields } from './assembly-details';

setupRitewayBun();

test('refused detail drafts preserve values and the submitted revision', () => {
  const html = renderToStaticMarkup(
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
      html.includes('Typed title'),
      html.includes('Typed topic'),
      html.includes('name="expectedVersion" value="3"'),
      html.includes('previous-command'),
      html.includes('Review latest room'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('non-host details remain visible but cannot submit an edit', () => {
  const html = renderToStaticMarkup(
    <AssemblyDetailsFields
      view={{
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
      }}
      commandId="unused-command"
      state={{ values: {} }}
      pending={false}
    />,
  );
  assert({
    given: 'a canonical non-editable projection',
    should: 'show stored details, mark inputs read-only and omit Save',
    actual: [
      html.includes('Persisted room'),
      html.includes('readOnly=""'),
      html.includes('Only the host can edit this room.'),
      html.includes('Save room details'),
    ],
    expected: [true, true, true, false],
  });
});
