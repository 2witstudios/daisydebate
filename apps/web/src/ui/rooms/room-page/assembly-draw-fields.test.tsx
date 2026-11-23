import type { RoomView } from '@daisy/protocol/room-contract';
import { drawCapableBounds } from '@daisy/protocol/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { DrawFields } from './assembly-draw-fields';

setupRitewayBun();

const capable: RoomView = {
  ...assemblySnapshot,
  definition: {
    ...assemblySnapshot.definition,
    configurable: {
      ...assemblySnapshot.definition.configurable,
      resolutionDraw: drawCapableBounds,
    },
  },
};
const striking: RoomView = {
  ...capable,
  topic: null,
  config: {
    ...capable.config,
    resolutionDraw: {
      enabled: true,
      drawSize: 5,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'host', count: 3 },
    },
  },
  seatsHeldFromViewer: { side: 0, speaker: 0, judge: 0, moderator: 0 },
  authoredDrawSource: { resolutions: ['First line', 'Second line'] },
};
const render = (view: RoomView, error?: string) =>
  renderAccessible(
    <DrawFields
      view={view}
      state={
        error
          ? { values: { drawSize: '6', drawSource: 'bank' }, error }
          : { values: {}, error: undefined }
      }
      disabled={false}
    />,
  );

const strikeToggle = /^Resolution strike /;
const replacementTopic = /^Resolution without a strike /;

test('the strike fieldset follows the format and the room (PR #472 review)', () => {
  // Each render replaces the one before it, so each is read as it is made.
  const none = render(assemblySnapshot).textContent();
  const off = render(capable);
  const offRead = {
    controls: [
      off.attribute('checkbox', strikeToggle, 'name'),
      off.all('radio').map((radio) => radio.getAttribute('name')),
      off.attribute('combobox', 'Resolutions drawn', 'name'),
      off.attribute('combobox', 'Strikes first', 'name'),
      off.attribute('textbox', /^Time per strike /, 'name'),
      off.attribute('textbox', 'Your resolutions, one per line', 'name'),
    ],
    sizes: off
      .within('combobox', 'Resolutions drawn')
      .names('option')
      .map(Number)
      .filter((n) => n >= 3 && n <= 7).length,
    topic: off.has('textbox', replacementTopic),
  };
  const on = render(striking);
  const onRead = {
    authorLines: (
      on.get('textbox', 'Your resolutions, one per line') as HTMLTextAreaElement
    ).value,
    topic: on.attribute('textbox', replacementTopic, 'name'),
  };
  const refused = render(striking, 'Those settings don’t fit this format.');
  assert({
    given:
      'a format with no strike, one that allows it switched off, the room striking from the host’s list, and a refused save',
    should:
      'offer nothing without the capability, every native control within its bounds, the author’s own lines, and keep the refused choices',
    actual: {
      none,
      controls: offRead.controls,
      sizes: offRead.sizes,
      authorLines: onRead.authorLines,
      replacementTopic: [offRead.topic, onRead.topic],
      // The option the server marks selected: happy-dom's live selectedness
      // goes stale across the helper's repeated mounts, so the state query
      // cannot be trusted here.
      keptSize: refused
        .within('combobox', 'Resolutions drawn')
        .all('option')
        .filter((option) => option.hasAttribute('selected'))
        .map((option) => option.textContent),
    },
    expected: {
      none: '',
      controls: [
        'resolutionDraw',
        ['drawSource', 'drawSource'],
        'drawSize',
        'drawFirstStriker',
        'duration.strikeWindow',
        'drawResolutions',
      ],
      sizes: 5,
      authorLines: 'First line\nSecond line',
      replacementTopic: [false, 'drawTopic'],
      keptSize: ['6'],
    },
  });
});
