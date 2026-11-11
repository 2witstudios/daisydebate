import { renderToStaticMarkup } from 'react-dom/server';
import { idle } from '../../../features/forms/form-state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CloseRoom } from './close-room';

setupRitewayBun();
const action = async () => idle();

describe('CloseRoom', () => {
  const html = renderToStaticMarkup(
    <CloseRoom version={7} commandId="close-id" action={action} />,
  );

  test('the trigger announces a dialog and the confirm starts closed', () => {
    assert({
      given: 'the server render',
      should: 'link Close room as opening a dialog, and keep it closed',
      actual: [
        /<button[^>]*aria-haspopup="dialog"[^>]*>Close room<\/button>/.test(
          html,
        ),
        /<dialog[^>]*\sopen(=|\s|>)/.test(html),
        html.includes('<details'),
      ],
      expected: [true, false, false],
    });
  });

  test('the dialog stays hidden until the host opens it', () => {
    assert({
      given: 'the dialog markup',
      should:
        'display the confirm only while open, never as an unconditional flex',
      actual: [
        html.includes('open:flex'),
        /(?:^|\s)flex(?:\s|$)/.test(
          html.match(/<dialog[^>]*class="([^"]*)"/)?.[1] ?? '',
        ),
      ],
      expected: [true, false],
    });
  });

  test('a named dialog carries the consequence and the close command', () => {
    assert({
      given: 'the dialog markup',
      should:
        'name it by its heading, state nobody can return, and post the close command behind Cancel',
      actual: [
        html.includes('aria-labelledby="close-room-title"'),
        /<h2 id="close-room-title"[^>]*>Close this room for everyone\?<\/h2>/.test(
          html,
        ),
        html.includes('Nobody can join or start a round in it again.'),
        html.includes('>Cancel<'),
        html.includes('>Close room for everyone<'),
        html.includes('name="type" value="close"'),
        html.includes('name="expectedVersion" value="7"'),
        html.includes('name="commandId" value="close-id"'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });
});
