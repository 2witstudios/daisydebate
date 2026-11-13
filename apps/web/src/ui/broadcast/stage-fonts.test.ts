import { assert, setupRitewayBun, test } from 'riteway/bun';
import { whenFontsSettle } from './stage-fonts';

setupRitewayBun();

const never = () => new Promise<never>(() => {});
const settledBy = async (
  load: () => Promise<unknown>,
  wait: () => Promise<void>,
) => {
  const order: string[] = [];
  await whenFontsSettle({
    load: () => load().finally(() => order.push('faces')),
    wait: () => wait().then(() => void order.push('limit')),
    limitMs: 2000,
  });
  return order;
};

test('the start signal waits for the frame’s faces, but not for ever', async () => {
  assert({
    given:
      'faces that load, faces that never do, faces that fail, and a browser that cannot be asked',
    should: 'settle on the faces, on the limit, and on either failure',
    actual: [
      await settledBy(() => Promise.resolve(), never),
      await settledBy(never, () => Promise.resolve()),
      await settledBy(() => Promise.reject(new Error('no font')), never),
      await whenFontsSettle({
        load: () => {
          throw new Error('no font API');
        },
        wait: never,
        limitMs: 2000,
      }).then(() => 'settled'),
    ],
    expected: [['faces'], ['limit'], ['faces'], 'settled'],
  });
});
