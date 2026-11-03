import { assert, setupRitewayBun, test } from 'riteway/bun';
import { joinReadInFlight } from './in-flight-read';

setupRitewayBun();

const scripted = () => {
  const settle: ((value: string) => void)[] = [];
  let reads = 0;
  return {
    reads: () => reads,
    settle: (value: string) => settle.shift()!(value),
    read: () => {
      reads += 1;
      return new Promise<string>((resolve) => settle.push(resolve));
    },
  };
};

test('readers arriving during a read join it; none is held after it', async () => {
  const world = scripted();
  const join = joinReadInFlight<string>();
  const crowd = [join('a', world.read), join('a', world.read)];
  world.settle('first');
  const answers = await Promise.all(crowd);
  const after = join('a', world.read);
  world.settle('second');
  assert({
    given: 'two asks during one read, then one after it settled',
    should: 'read once for the two and fresh for the third',
    actual: [...answers, await after, world.reads()],
    expected: ['first', 'first', 'second', 2],
  });
});

test('a Round joins only its own read', async () => {
  const world = scripted();
  const join = joinReadInFlight<string>();
  const a = join('a', world.read);
  const b = join('b', world.read);
  world.settle('of a');
  world.settle('of b');
  assert({
    given: 'two Rounds read at once',
    should: 'answer each its own',
    actual: [await a, await b],
    expected: ['of a', 'of b'],
  });
});

test('a failed read is not kept', async () => {
  const join = joinReadInFlight<string>();
  await join('a', () => Promise.reject(new Error('down'))).catch(() => null);
  assert({
    given: 'a read that failed',
    should: 'read again',
    actual: await join('a', async () => 'back'),
    expected: 'back',
  });
});
