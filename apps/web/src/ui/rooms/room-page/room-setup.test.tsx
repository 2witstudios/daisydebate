import { idle } from '../../../features/forms/form-state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assemblySnapshot,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
import { WithAppRouter } from '../../test-support/app-router';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { savedAnswer } from './assembly-edit-form';
import { RoomSetup, finishSetupSave } from './room-setup';
import { sheetOpen } from './room-setup-modal';

setupRitewayBun();
const action = async () => idle();
const view = renderAccessible(
  <WithAppRouter>
    <RoomSetup
      view={assemblySnapshot}
      choices={[unequalTemplate]}
      commandIds={{
        details: 'details-id',
        settings: 'settings-id',
        capture: 'capture-id',
      }}
      formatIds={{
        choose: 'choose-id',
        reset: 'reset-id',
        template: 'template-id',
      }}
      detailsAction={action}
      settingsAction={action}
      commandAction={action}
    />
  </WithAppRouter>,
);

test('Edit settings is one modal dialog its fragment opens', () => {
  assert({
    given: 'the host’s room',
    should:
      'render a labelled modal dialog with the room-setup id, closing by a link back to the room',
    actual: [
      view.get('dialog', 'Settings').id,
      view.attribute('dialog', 'Settings', 'aria-modal'),
      view
        .within('dialog', 'Settings')
        .attribute('link', 'Close settings', 'href'),
    ],
    expected: ['room-setup', 'true', `/rooms/${assemblySnapshot.id}`],
  });
});

/** A named form's hidden field value, which no role states. */
const hidden = (form: string, name: string) =>
  view
    .get('form', form)
    .querySelector(`input[type="hidden"][name="${name}"]`)
    ?.getAttribute('value');

test('both forms keep their native posts, basics first and the rules closed', () => {
  assert({
    given: 'an unrefused room',
    should:
      'hold the room details, format and round settings forms, with the rules disclosure closed',
    actual: [
      hidden('Room details', 'commandId'),
      hidden('Round settings', 'commandId'),
      view
        .all('group')
        .some(
          (group) => group.tagName === 'DETAILS' && group.hasAttribute('open'),
        ),
      view
        .get('dialog', 'Settings')
        .querySelector('input[type="hidden"][value="choose-id"]') !== null,
      view
        .textContent()
        .includes('The format and rating are set when the room is created.'),
    ],
    expected: ['details-id', 'settings-id', false, true, false],
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
      'nothing answered yet, an accepted save, a refusal, and a save whose answer was lost',
    should: 'count only the accepted save',
    actual: [
      savedAnswer(idle()),
      savedAnswer({ kind: 'accepted', view: assemblySnapshot }),
      savedAnswer({
        kind: 'refused',
        values: {},
        error: 'The room changed.',
      }),
      savedAnswer({ kind: 'unacknowledged', values: {} }),
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
