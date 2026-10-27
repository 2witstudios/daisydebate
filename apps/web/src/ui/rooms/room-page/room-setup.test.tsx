import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { WithAppRouter } from '../../test-support/app-router';
import { savedAnswer } from './assembly-edit-form';
import { RoomSetup, sheetOpen, finishSetupSave } from './room-setup';

setupRitewayBun();
const action = async () => ({ values: {} });
const html = renderToStaticMarkup(
  <WithAppRouter>
    <RoomSetup
      view={assemblySnapshot}
      commandIds={{ details: 'details-id', settings: 'settings-id' }}
      detailsAction={action}
      settingsAction={action}
    />
  </WithAppRouter>,
);

test('Room setup is one modal sheet its fragment opens', () => {
  assert({
    given: 'the host’s room',
    should:
      'render a labelled modal dialog with the room-setup id, closing by a link back to the room',
    actual: [
      html.includes('id="room-setup"'),
      html.includes('role="dialog"'),
      html.includes('aria-modal="true"'),
      html.includes('aria-labelledby="room-setup-title"'),
      html.includes(
        `href="/rooms/${assemblySnapshot.id}" aria-label="Close room setup"`,
      ),
    ],
    expected: [true, true, true, true, true],
  });
});

test('both forms keep their native posts, basics first and the rules closed', () => {
  assert({
    given: 'an unrefused room',
    should:
      'hold the room details and round settings forms, with the rules disclosure closed',
    actual: [
      html.includes('aria-label="Room details"'),
      html.includes('aria-label="Round settings"'),
      html.includes('value="details-id"'),
      html.includes('value="settings-id"'),
      /<details[^>]*\sopen/.test(html),
      html.includes('The format and rating are set when the room is created.'),
    ],
    expected: [true, true, true, true, false, true],
  });
});

test('the sheet is open while its fragment is the URL’s or a refused save is on it', () => {
  assert({
    given:
      'the room-setup fragment, another fragment, none, and a refusal without the fragment',
    should: 'open for the fragment or a refusal only',
    actual: [
      sheetOpen('#room-setup', false),
      sheetOpen('#other', false),
      sheetOpen('', false),
      sheetOpen('', true),
    ],
    expected: [true, false, false, true],
  });
});

test('an accepted save closes the sheet, as the native redirect does', () => {
  assert({
    given:
      'nothing answered yet, an accepted save, a refusal, and a refusal that still carries a view',
    should: 'count only the accepted save',
    actual: [
      savedAnswer({ values: {} }),
      savedAnswer({ values: {}, view: assemblySnapshot }),
      savedAnswer({ values: {}, error: 'The room changed.' }),
      savedAnswer({
        values: {},
        view: assemblySnapshot,
        error: 'The room changed.',
      }),
    ],
    expected: [false, true, false, false],
  });
});

test('an accepted sibling save leaves setup even when another form holds a refusal', () => {
  const outcomes = [false, true].map((canClose) => {
    let navigated = false;
    finishSetupSave(
      () => canClose,
      () => {
        navigated = true;
      },
    );
    return navigated;
  });
  assert({
    given: 'an accepted save with and without a stale sibling refusal',
    should: 'navigate to clear a stale refusal, otherwise close in place',
    actual: outcomes,
    expected: [true, false],
  });
});
