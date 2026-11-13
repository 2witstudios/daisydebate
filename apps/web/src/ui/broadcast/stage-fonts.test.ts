import { assert, setupRitewayBun, test } from 'riteway/bun';
import { whenFontsSettle } from './stage-fonts';

setupRitewayBun();

const settled = async (deps: {
  readonly ready: () => Promise<unknown>;
  readonly wait: () => Promise<void>;
}) => {
  const order: string[] = [];
  await whenFontsSettle({
    ready: () => deps.ready().then(() => order.push('fonts')),
    frame: (run) => run(),
    wait: () => deps.wait().then(() => void order.push('limit')),
    limitMs: 2000,
  });
  return order;
};

test('the start signal waits for the frame’s faces, but not for ever', async () => {
  const never = () => new Promise<never>(() => {});
  assert({
    given: 'faces that load, faces that never do, and faces that fail',
    should: 'settle on the faces, then on the limit, then on the failure',
    actual: [
      await settled({ ready: () => Promise.resolve(), wait: never }),
      await settled({ ready: never, wait: () => Promise.resolve() }),
      await whenFontsSettle({
        ready: () => Promise.reject(new Error('no font')),
        frame: (run) => run(),
        wait: never,
        limitMs: 2000,
      }).then(() => 'settled'),
    ],
    expected: [['fonts'], ['limit'], 'settled'],
  });
});
