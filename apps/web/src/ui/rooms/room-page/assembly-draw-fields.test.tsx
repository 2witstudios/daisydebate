import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { drawCapableBounds } from '@daisy/protocol/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
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
  authoredDrawSource: { resolutions: ['First line', 'Second line'] },
};
const render = (view: RoomView, error?: string) =>
  renderToStaticMarkup(
    <DrawFields
      view={view}
      state={
        error
          ? { values: { drawSize: '6', drawSource: 'bank' }, error }
          : { values: {} }
      }
      disabled={false}
    />,
  );

test('the strike fieldset follows the format and the room (PR #472 review)', () => {
  const off = render(capable);
  const on = render(striking);
  const refused = render(striking, 'Those settings don’t fit this format.');
  assert({
    given:
      'a format with no strike, one that allows it switched off, the room striking from the host’s list, and a refused save',
    should:
      'offer nothing without the capability, every native control within its bounds, the author’s own lines, and keep the refused choices',
    actual: {
      none: render(assemblySnapshot),
      controls: [
        'name="resolutionDraw"',
        'name="drawSource"',
        'name="drawSize"',
        'name="drawFirstStriker"',
        'name="duration.strikeWindow"',
        'name="drawResolutions"',
      ].every((control) => off.includes(control)),
      sizes: [...off.matchAll(/<option value="(\d+)"/g)]
        .map((m) => Number(m[1]))
        .filter((n) => n >= 3 && n <= 7).length,
      authorLines: on.includes('First line\nSecond line'),
      replacementTopic: [
        off.includes('name="drawTopic"'),
        on.includes('name="drawTopic"'),
      ],
      keptSize: /<option value="6" selected=""/.test(refused),
    },
    expected: {
      none: '',
      controls: true,
      sizes: 5,
      authorLines: true,
      replacementTopic: [false, true],
      keptSize: true,
    },
  });
});
