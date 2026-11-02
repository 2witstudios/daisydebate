import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ConsentControls } from './consent-controls';

setupRitewayBun();

test('an unreadable stored choice offers no form to overwrite it', () => {
  const props = {
    consent: {
      version: 1,
      necessary: 'granted',
      analytics: 'granted',
      replay: 'unanswered',
    },
    available: { analytics: true, replay: false },
  } as Parameters<typeof ConsentControls>[0];
  const readable = renderToString(<ConsentControls {...props} />);
  const unreadable = renderToString(
    <ConsentControls {...props} consentUnreadable />,
  );
  assert({
    given: 'a readable choice, and a choice a refusal left unreadable',
    should: 'show the form only for the readable one, and say why otherwise',
    actual: [
      readable.includes('<form'),
      unreadable.includes('<form'),
      unreadable.includes('role="status"'),
    ],
    expected: [true, false, true],
  });
});
