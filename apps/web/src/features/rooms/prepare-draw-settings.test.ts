import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { prepareSettings } from './prepare-settings';

setupRitewayBun();

const drawCapable: RoomView = {
  ...assemblySnapshot,
  definition: {
    ...assemblySnapshot.definition,
    configurable: {
      ...assemblySnapshot.definition.configurable,
      resolutionDraw: {
        drawSize: { min: 3, max: 7 },
        strikeWindowMs: { min: 15_000, max: 180_000 },
        firstStrikers: ['negative', 'affirmative'],
        sources: ['bank', 'host'],
      },
    },
  },
};
const withDraw: RoomView = {
  ...drawCapable,
  topic: null,
  config: {
    ...drawCapable.config,
    resolutionDraw: {
      enabled: true,
      drawSize: 5,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
    },
  },
};

/** The fixture's own settings, as the native form posts them. */
const form = (view: RoomView, draw: Record<string, string>) => {
  const fields = new FormData();
  fields.set('expectedVersion', String(view.version));
  fields.set('commandId', 'c'.repeat(24));
  fields.set('preRoundPrep', 'on');
  fields.set('duration.preRound', '5:21');
  fields.set('inRoundPrep', 'on');
  fields.set('duration.budget', '14:47');
  fields.set('duration.countdown', '0:00.444');
  fields.set('duration.segment.N3', '1:38.765');
  fields.set('duration.segment.A1', '1:00');
  fields.set('crossExMode', 'free');
  fields.set('interruptionsMode', 'disabled');
  fields.set('duration.minRemaining', '0:01.234');
  fields.set('yield', 'off');
  for (const [name, value] of Object.entries(draw)) fields.set(name, value);
  return fields;
};
const strikeOn = {
  resolutionDraw: 'on',
  drawSource: 'host',
  drawResolutions: 'One\nTwo\nThree\nFour\nFive',
  drawSize: '5',
  drawFirstStriker: 'negative',
  'duration.strikeWindow': '1:00',
};
const command = (prepared: ReturnType<typeof prepareSettings>) =>
  prepared.kind === 'prepared' && prepared.command.type === 'update-config'
    ? prepared.command
    : prepared.kind;

test('turning the strike on clears the topic in the same command', () => {
  const prepared = command(
    prepareSettings(drawCapable, form(drawCapable, strikeOn)),
  );
  assert({
    given: 'a fixed-topic room switching to a five-line host strike',
    should: 'post the draw and topic null together',
    actual:
      typeof prepared === 'string'
        ? prepared
        : [prepared.topic, prepared.config.resolutionDraw],
    expected: [
      null,
      {
        enabled: true,
        drawSize: 5,
        strikeWindowMs: 60_000,
        firstStriker: 'negative',
        source: {
          kind: 'host',
          resolutions: ['One', 'Two', 'Three', 'Four', 'Five'],
        },
      },
    ],
  });
});

test('turning the strike off needs the resolution to debate', () => {
  assert({
    given:
      'a draw room turning the strike off without, then with, a resolution',
    should: 'refuse the form, then post the typed topic',
    actual: [
      command(prepareSettings(withDraw, form(withDraw, {}))),
      (() => {
        const prepared = command(
          prepareSettings(withDraw, form(withDraw, { drawTopic: 'A motion' })),
        );
        return typeof prepared === 'string' ? prepared : prepared.topic;
      })(),
    ],
    expected: ['invalid', 'A motion'],
  });
});

test('keeping the strike state carries no topic', () => {
  const prepared = command(
    prepareSettings(
      withDraw,
      form(withDraw, { ...strikeOn, drawSource: 'bank', drawSize: '7' }),
    ),
  );
  assert({
    given: 'a draw room changing only the draw size',
    should: 'post the new size, keep the bank categories and send no topic',
    actual:
      typeof prepared === 'string'
        ? prepared
        : [
            'topic' in prepared,
            prepared.config.resolutionDraw.enabled &&
              prepared.config.resolutionDraw.drawSize,
          ],
    expected: [false, 7],
  });
});
