import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
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
  const html = renderToStaticMarkup(
    <PlayDialog>
      <p>choices</p>
    </PlayDialog>,
  );

  test('is a link to /play before any script runs', () => {
    assert({
      given: 'the server render',
      should: 'link Play to /play, announce a dialog, and keep it closed',
      actual: [
        /<a[^>]*href="\/play"[^>]*aria-haspopup="dialog"[^>]*>Play<\/a>/.test(
          html,
        ),
        /<dialog[^>]*\sopen(=|\s|>)/.test(html),
      ],
      expected: [true, false],
    });
  });

  test('a named dialog with the choices and two ways to close', () => {
    assert({
      given: 'the dialog markup',
      should:
        'name it by its Play heading, hold the choices, and close from Close and Just browse the Lobby',
      actual: [
        html.includes('aria-labelledby="play-dialog-title"'),
        /<h2 id="play-dialog-title"[^>]*>Play<\/h2>/.test(html),
        html.includes('<p>choices</p>'),
        (html.match(/<form[^>]*method="dialog"/g) ?? []).length,
        html.includes('aria-label="Close"'),
        html.includes('Just browse the Lobby'),
      ],
      expected: [true, true, true, 2, true, true],
    });
  });
});
