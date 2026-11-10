import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ObservedRound } from '../../features/round-runtime/observed-round';
import type { JudgeRoomStage } from '../../features/judge/judge-room-stage';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './judge-now.test-support';

setupRitewayBun();

const observed: ObservedRound = {
  stage: 'speech',
  clock: { label: 'NC · Negative constructive', remainingMs: 360_000 },
  seats: [],
  speeches: [],
  prepMs: null,
  judge: 'human',
};
const stage = (key: string, heading: string): JudgeRoomStage => ({
  key,
  heading,
  detail: 'Next: CX2.',
});

test('a stage the judge did not trigger takes free focus, and is announced otherwise', async () => {
  const { act, createElement, root, JudgeNow, container, browser } =
    await mountBrowserClient<typeof Client>(
      Bun.resolveSync('./judge-now.test-support', import.meta.dir),
    );
  const field = browser.document.createElement('input');
  browser.document.body.append(field);
  const show = (key: string, heading: string) =>
    act(async () =>
      root.render(
        createElement(JudgeNow, { observed, stage: stage(key, heading) }),
      ),
    );
  const heading = () => container.querySelector('#judge-now');
  const region = () =>
    container.querySelector('#judge-now-notice')?.textContent ?? null;
  try {
    await show('speech-0', 'AC · Affirmative constructive');
    const first = [browser.document.activeElement === heading(), region()];
    await show('speech-2', 'NC · Negative constructive');
    const free = [browser.document.activeElement === heading(), region()];
    await act(async () => field.focus());
    await show('speech-4', '1AR · First affirmative rebuttal');
    const held = [browser.document.activeElement === field, region()];
    assert({
      given:
        'the first render, then a new stage with focus free, then one while a field holds focus',
      should:
        'move nothing first; then focus the Now heading without a second announcement; then keep the field focused and announce the stage, its time and what is next',
      actual: [first, free, held],
      expected: [
        [false, ''],
        [true, ''],
        [true, 'Now: 1AR · First affirmative rebuttal, 6:00. Next: CX2.'],
      ],
    });
  } finally {
    await act(async () => root.unmount());
  }
});
