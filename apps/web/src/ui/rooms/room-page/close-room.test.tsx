import { idle } from '../../../features/forms/form-state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { CloseRoom } from './close-room';

setupRitewayBun();
const action = async () => idle();

/** The fields a submit button posts with its form. */
const posted = (button: Element) => {
  const form = (button as HTMLButtonElement).form;
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name]') ?? [])].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );
};

describe('CloseRoom', () => {
  const view = renderAccessible(
    <CloseRoom version={7} commandId="close-id" action={action} />,
  );

  test('the trigger announces a dialog and the confirm starts closed', () => {
    assert({
      given: 'the server render',
      should: 'link Close room as opening a dialog, and keep it closed',
      actual: [
        view.attribute('button', 'Close room', 'aria-haspopup'),
        view.has('dialog'),
        view.has('dialog', undefined, { hidden: true }),
        view
          .all('group', undefined, { hidden: true })
          .some((group) => group.tagName === 'DETAILS'),
      ],
      expected: ['dialog', false, true, false],
    });
  });

  test('a named dialog carries the consequence and the close command', () => {
    // A closed dialog's aria-labelledby name is not computed (the heading is
    // hidden with it), so the test checks that the label points at the heading.
    const dialog = view.within('dialog', undefined, { hidden: true });
    const heading = dialog.get('heading', 'Close this room for everyone?', {
      level: 2,
      hidden: true,
    });
    assert({
      given: 'the dialog markup',
      should:
        'name it by its heading, state nobody can return, and post the close command behind Cancel',
      actual: [
        view.attribute('dialog', undefined, 'aria-labelledby', {
          hidden: true,
        }) === heading.id,
        dialog
          .textContent()
          .includes('Nobody can join or start a round in it again.'),
        dialog.has('button', 'Cancel', { hidden: true }),
        posted(
          dialog.get('button', 'Close room for everyone', { hidden: true }),
        ),
      ],
      expected: [
        true,
        true,
        true,
        { type: 'close', expectedVersion: '7', commandId: 'close-id' },
      ],
    });
  });
});
