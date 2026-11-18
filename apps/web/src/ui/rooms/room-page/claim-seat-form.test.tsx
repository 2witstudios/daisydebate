import { FormData as BrowserFormData } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refused } from '../../../features/forms/form-state';
import {
  commandRefusalText,
  type RoomFormState,
} from '../../../features/rooms/command-answer';
import { seatOnOtherLadder } from '../../../features/play/ladder-division-words';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import { WithAppRouter } from '../../test-support/app-router';
import type * as Client from './claim-seat-form.test-support';
import { ClaimSeatForm } from './claim-seat-form';

setupRitewayBun();

const realm = {
  URL,
  URLSearchParams,
  FormData: BrowserFormData,
  performance,
  process: { env: { NODE_ENV: 'test' } },
};
const youthRoom = seatOnOtherLadder('youth', 'open');

test('Take seat posts the claim of its seat', () => {
  const html = renderToStaticMarkup(
    <WithAppRouter>
      <ClaimSeatForm
        action={async () => refused(new FormData(), '')}
        version={3}
        commandId={'c'.repeat(24)}
        seat={{ kind: 'side', side: 'negative', slot: 0 }}
        name="Take Negative"
        className="inline-flex"
        otherLadder={youthRoom}
      />
    </WithAppRouter>,
  );
  assert({
    given: 'an open debater seat before any answer',
    should:
      'post a claim of that seat under its command and say nothing about ladders',
    actual: [
      html.includes('name="type" value="claim-seat"'),
      html.includes('name="seat" value="{&quot;kind&quot;:&quot;side&quot;'),
      /<button[^>]*aria-label="Take Negative"[^>]*>Take seat<\/button>/.test(
        html,
      ),
      html.includes('disabled'),
      html.includes(youthRoom.title),
    ],
    expected: [true, true, true, false, false],
  });
});

const pressed = async (
  answer: RoomFormState,
  otherLadder: typeof youthRoom | null,
) => {
  const { act, createElement, root, container, ClaimSeatHarness } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./claim-seat-form.test-support', import.meta.dir),
      realm,
    );
  try {
    await act(async () =>
      root.render(
        createElement(ClaimSeatHarness, {
          action: async () => answer,
          otherLadder,
        }),
      ),
    );
    await act(async () => container.querySelector('button')!.click());
    const button = container.querySelector('button')!;
    return {
      disabled: button.hasAttribute('disabled'),
      status:
        container.querySelector('[data-ladder-refusal]')?.textContent ?? null,
      alert: container.querySelector('[role="alert"]')?.textContent ?? null,
    };
  } finally {
    await act(async () => root.unmount());
  }
};

test('a debater seat on the viewer’s other ladder says whose seat it is', async () => {
  const onOtherLadder = refused(
    new FormData(),
    commandRefusalText('ranked-division'),
  );
  assert({
    given:
      'an adult whose claim of a Youth Room’s debater seat is refused for its ladder',
    should:
      'close Take seat and name the seat’s ladder and what they can do instead, in place of the bare refusal',
    actual: await pressed(onOtherLadder, youthRoom),
    expected: {
      disabled: true,
      status: `${youthRoom.title} ${youthRoom.body}`,
      alert: null,
    },
  });
  assert({
    given: 'the same refusal where the Room names no other ladder for them',
    should: 'show the refusal’s own words',
    actual: await pressed(onOtherLadder, null),
    expected: {
      disabled: false,
      status: null,
      alert: commandRefusalText('ranked-division'),
    },
  });
});

test('any other refusal reads as every room command’s', async () => {
  const taken = commandRefusalText('seat-unavailable');
  assert({
    given: 'a seat someone else just took, on a Room on the other ladder',
    should: 'say the seat went, and keep Take seat',
    actual: await pressed(refused(new FormData(), taken), youthRoom),
    expected: { disabled: false, status: null, alert: taken },
  });
});
