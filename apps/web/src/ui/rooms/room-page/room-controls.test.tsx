import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { idle } from '../../../features/forms/form-state';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { RoomControls } from './room-controls';

setupRitewayBun();

const render = (view: RoomView) =>
  renderToStaticMarkup(
    <RoomControls
      view={view}
      commandIds={{ visibility: 'visibility-id', capture: 'capture-id' }}
      commandAction={async () => idle()}
    />,
  );

const host = (more: Partial<RoomView> = {}): RoomView => ({
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, canEdit: true },
  captureOffer: 'included',
  capture: null,
  ...more,
});
const guest = (more: Partial<RoomView> = {}): RoomView => {
  const view = host(more);
  return { ...view, capabilities: { ...view.capabilities, canEdit: false } };
};

/** The form holding `marker`, or null. */
const formWith = (html: string, marker: string) =>
  [...html.matchAll(/<form[\s\S]*?<\/form>/g)]
    .map(([form]) => form)
    .find((form) => form.includes(marker)) ?? null;
const hidden = (form: string | null) =>
  [...(form ?? '').matchAll(/type="hidden" name="(\w+)" value="([^"]*)"/g)]
    .map(([, name, value]) => `${name}=${value}`)
    .filter((pair) => !/^(commandId|expectedVersion)=/.test(pair));

test('who can join', () => {
  const html = render(host({ visibility: 'unlisted', topic: 'Saved topic' }));
  const form = formWith(html, 'name="visibility"');
  assert({
    given: 'the host of an unlisted Room with a fixed topic',
    should:
      'offer public then unlisted, never private, posting who can join alone (ISSUE-443, D9)',
    actual: {
      options: [...(form ?? '').matchAll(/<option value="(\w+)"/g)].map(
        ([, value]) => value,
      ),
      fields: hidden(form),
    },
    expected: {
      options: ['public', 'unlisted'],
      fields: ['type=set-visibility'],
    },
  });
});

test('broadcast and record switches', () => {
  const html = render(
    host({
      capture: {
        broadcast: {
          release: { kind: 'delay', seconds: 300 },
          debatersReadChat: false,
        },
        recordingPolicy: 'off',
      },
    }),
  );
  assert({
    given: 'a Room broadcast on a five minute delay and not recorded',
    should:
      'show the delay as words, and let each switch keep the other choice as saved',
    actual: {
      delay: html.includes('5 min delay'),
      broadcast: hidden(formWith(html, 'id="room-broadcast"')),
      record: hidden(formWith(html, 'id="room-recording"')),
    },
    expected: {
      delay: true,
      broadcast: ['type=set-capture', 'release=delay:300'],
      record: ['type=set-capture', 'release=delay:300', 'broadcast=on'],
    },
  });
});

test('without the capture grant', () => {
  const html = render(host({ captureOffer: 'premium' }));
  const none = render(host({ captureOffer: null }));
  assert({
    given: 'a casual host without Premium, then a Room that offers no capture',
    should:
      'show two off switches that post nothing and no panel until reached for, then who can join alone',
    actual: [
      (html.match(/role="switch"/g) ?? []).length,
      /name="(broadcast|recording)"/.test(html),
      html.includes('href="/premium"'),
      html.includes('Recording and broadcast are Premium'),
      none.includes('Broadcast'),
    ],
    expected: [2, false, false, false, false],
  });
});

test('everyone else', () => {
  const html = render(
    guest({
      capture: {
        broadcast: {
          release: { kind: 'delay', seconds: 10 },
          debatersReadChat: true,
        },
        recordingPolicy: 'released',
      },
    }),
  );
  assert({
    given: 'a member who is not the host',
    should: 'show the saved values with nothing to change',
    actual: [
      html.includes('<form'),
      html.includes('Listed in the lobby'),
      html.includes('10 s delay'),
      (html.match(/>On</g) ?? []).length,
    ],
    expected: [false, true, true, 2],
  });
});

test('a free host reaching for a capture switch sees the upgrade panel, and nothing posts', async () => {
  const { mountBrowserClient } =
    await import('../../test-support/browser-client.test-support');
  const client = await mountBrowserClient<
    typeof import('./room-controls.test-support')
  >(Bun.resolveSync('./room-controls.test-support', import.meta.dir), {
    URL,
    URLSearchParams,
    performance,
    process: { env: { NODE_ENV: 'test' } },
  });
  try {
    await client.act(async () =>
      client.root.render(client.createElement(client.FreeHostControls)),
    );
    const panel = () =>
      client.container.textContent?.includes(
        'Recording and broadcast are Premium',
      ) ?? false;
    const before = panel();
    const record = client.container.querySelector(
      '#room-recording',
    ) as unknown as { click: () => void; checked: boolean };
    await client.act(async () => record.click());
    assert({
      given: 'a free casual host who clicks the Record switch',
      should:
        'show the Premium panel in place, leave the switch off and post no capture command',
      actual: {
        before,
        after: panel(),
        checked: record.checked,
        posted: client.posted.length,
      },
      expected: { before: false, after: true, checked: false, posted: 0 },
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});
