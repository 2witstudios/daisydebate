import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol/room-contract';
import { idle } from '../../../features/forms/form-state';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import {
  accessibleWithin,
  renderAccessible,
} from '../../../test-support/rendered/accessible';
import { RoomControls } from './room-controls';
import type * as Client from './room-controls.test-support';

setupRitewayBun();

const render = (view: RoomView) =>
  renderAccessible(
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

/** The hidden fields the control's form posts beside it, without the command fence. */
const hidden = (control: Element) =>
  [
    ...((control as HTMLInputElement).form?.querySelectorAll(
      'input[type="hidden"]',
    ) ?? []),
  ]
    .map((input) => input as HTMLInputElement)
    .map(({ name, value }) => `${name}=${value}`)
    .filter((pair) => !/^(commandId|expectedVersion)=/.test(pair));

test('who can join', () => {
  const view = render(host({ visibility: 'unlisted', topic: 'Saved topic' }));
  const select = view.get('combobox', 'Who can join');
  assert({
    given: 'the host of an unlisted Room with a fixed topic',
    should:
      'offer public then unlisted, never private, posting who can join alone (ISSUE-443, D9)',
    actual: {
      options: view
        .within('combobox', 'Who can join')
        .all('option')
        .map((option) => (option as HTMLOptionElement).value),
      fields: hidden(select),
    },
    expected: {
      options: ['public', 'unlisted'],
      fields: ['type=set-visibility'],
    },
  });
});

test('broadcast and record switches', () => {
  const view = render(
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
      delay: view.textContent().includes('5 min delay'),
      broadcast: hidden(view.get('switch', 'Broadcast')),
      record: hidden(view.get('switch', 'Record')),
    },
    expected: {
      delay: true,
      broadcast: ['type=set-capture', 'release=delay:300'],
      record: ['type=set-capture', 'release=delay:300', 'broadcast=on'],
    },
  });
});

test('without the capture grant', () => {
  const view = render(host({ captureOffer: 'premium' }));
  const switches = view.all('switch') as readonly HTMLInputElement[];
  const premiumLink = view
    .all('link')
    .some((link) => link.getAttribute('href') === '/premium');
  const panel = view
    .textContent()
    .includes('Recording and broadcast are Premium');
  const none = render(host({ captureOffer: null }));
  assert({
    given: 'a casual host without Premium, then a Room that offers no capture',
    should:
      'show two off switches that post nothing and no panel until reached for, then who can join alone',
    actual: [
      switches.length,
      switches.some((control) => control.name !== ''),
      premiumLink,
      panel,
      none.textContent().includes('Broadcast'),
    ],
    expected: [2, false, false, false, false],
  });
});

test('everyone else', () => {
  const view = render(
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
      view.get('region', 'Room controls').querySelector('form') !== null,
      view.textContent().includes('Listed in the lobby'),
      view.textContent().includes('10 s delay'),
      [...view.get('region', 'Room controls').querySelectorAll('*')].filter(
        (element) =>
          element.children.length === 0 && element.textContent === 'On',
      ).length,
    ],
    expected: [false, true, true, 2],
  });
});

test('a free host reaching for a capture switch sees the upgrade panel, and nothing posts', async () => {
  const { mountBrowserClient } =
    await import('../../test-support/browser-client.test-support');
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./room-controls.test-support', import.meta.dir),
    {
      URL,
      URLSearchParams,
      performance,
      process: { env: { NODE_ENV: 'test' } },
    },
  );
  try {
    await client.act(async () =>
      client.root.render(client.createElement(client.FreeHostControls)),
    );
    const shown = () =>
      accessibleWithin(client.container as unknown as Element);
    const panel = () =>
      shown().textContent().includes('Recording and broadcast are Premium');
    const before = panel();
    const record = shown().get('switch', 'Record') as HTMLInputElement;
    await client.act(async () => record.click());
    const after = panel();
    const notNow = () => shown().get('button', 'Not now') as HTMLButtonElement;
    await client.act(async () => notNow().click());
    const dismissed = panel();
    await client.act(async () => record.click());
    assert({
      given: 'a free casual host who clicks the Record switch',
      should:
        'show the Premium panel in place, hide it on Not now, show it again on the next reach, leave the switch off and post nothing',
      actual: {
        before,
        after,
        dismissed,
        again: panel(),
        checked: record.checked,
        posted: client.posted.length,
      },
      expected: {
        before: false,
        after: true,
        dismissed: false,
        again: true,
        checked: false,
        posted: 0,
      },
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});

test('a Room already showing the AI judge panel answers a capture reach with one plain line', async () => {
  const { mountBrowserClient } =
    await import('../../test-support/browser-client.test-support');
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./room-controls.test-support', import.meta.dir),
    {
      URL,
      URLSearchParams,
      performance,
      process: { env: { NODE_ENV: 'test' } },
    },
  );
  try {
    await client.act(async () =>
      client.root.render(
        client.createElement(client.FreeHostControls, {
          aiJudgeSeating: 'premium',
        }),
      ),
    );
    const shown = () =>
      accessibleWithin(client.container as unknown as Element);
    const record = shown().get('switch', 'Record') as HTMLInputElement;
    await client.act(async () => record.click());
    const text = shown().textContent();
    assert({
      given:
        'a free casual host whose roster shows the AI judge panel, clicking the Record switch',
      should:
        'say recording is Premium with a link, and add no second Get Premium button',
      actual: {
        line: text.includes('Recording and broadcast are Premium.'),
        link: shown().get('link', 'See Premium').getAttribute('href'),
        button: text.includes('Get Premium'),
        posted: client.posted.length,
      },
      expected: { line: true, link: '/premium', button: false, posted: 0 },
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});
