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
      detailsAction={async () => idle()}
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
      'offer public then unlisted, never private, posting the saved name and topic unchanged (ISSUE-443)',
    actual: {
      options: [...(form ?? '').matchAll(/<option value="(\w+)"/g)].map(
        ([, value]) => value,
      ),
      fields: hidden(form),
    },
    expected: {
      options: ['public', 'unlisted'],
      fields: [
        'type=update-details',
        `title=${assemblySnapshot.title}`,
        'topic=Saved topic',
      ],
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
        recording: false,
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
      'point to Premium instead of a switch, then show who can join alone',
    actual: [
      (html.match(/href="\/premium"/g) ?? []).length,
      html.includes('role="switch"'),
      none.includes('Broadcast'),
    ],
    expected: [2, false, false],
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
        recording: true,
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
