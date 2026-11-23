import { idle } from '../features/forms/form-state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { CloseRoom } from '../ui/rooms/room-page/close-room';

setupRitewayBun();
const action = async () => idle();

// Markup contract: the closed confirm's display is carried only by its
// classes (open:flex), which have no accessible equivalent to assert.
test('the dialog stays hidden until the host opens it', () => {
  const html = renderMarkup(
    <CloseRoom version={7} commandId="close-id" action={action} />,
  );
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
