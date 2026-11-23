import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { PlayDialog, opensInPlace } from './play-dialog';

setupRitewayBun();

const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe('opensInPlace', () => {
  test('only a plain primary click opens the dialog', () => {
    assert({
      given: 'a plain click, a middle click and each modifier held',
      should: 'open in place only for the plain click',
      actual: [
        opensInPlace(plain),
        opensInPlace({ ...plain, button: 1 }),
        opensInPlace({ ...plain, metaKey: true }),
        opensInPlace({ ...plain, ctrlKey: true }),
        opensInPlace({ ...plain, shiftKey: true }),
        opensInPlace({ ...plain, altKey: true }),
      ],
      expected: [true, false, false, false, false, false],
    });
  });
});

describe('PlayDialog', () => {
  const render = () =>
    renderAccessible(
      <PlayDialog>
        <p>choices</p>
      </PlayDialog>,
    );
  // A closed <dialog> is hidden from the tree; it and its content are asked
  // for with hidden.
  const hidden = { hidden: true } as const;

  test('is a link to /play before any script runs', () => {
    const view = render();
    assert({
      given: 'the server render',
      should: 'link Play to /play, announce a dialog, and keep it closed',
      actual: [
        view.attribute('link', 'Play', 'href'),
        view.attribute('link', 'Play', 'aria-haspopup'),
        view.count('dialog'),
        view.get('dialog', 'Play', hidden).hasAttribute('open'),
      ],
      expected: ['/play', 'dialog', 0, false],
    });
  });

  test('a named dialog with the choices and two ways to close', () => {
    const view = render();
    const dialog = view.within('dialog', 'Play', hidden);
    const closes = (button: string) =>
      dialog
        .get('button', button, hidden)
        .closest('form')
        ?.getAttribute('method');
    assert({
      given: 'the dialog markup',
      should:
        'name it by its Play heading, hold the choices, and close from Close and Just browse the Lobby',
      actual: [
        dialog.has('heading', 'Play', { ...hidden, level: 2 }),
        dialog.text('paragraph', undefined, hidden),
        closes('Close'),
        closes('Just browse the Lobby'),
      ],
      expected: [true, 'choices', 'dialog', 'dialog'],
    });
  });
});
