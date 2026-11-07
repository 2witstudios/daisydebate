import { assert, setupRitewayBun, test } from 'riteway/bun';
import { tracePropagationTargets } from './trace-propagation';
setupRitewayBun();
test('propagation admits only the explicit full trusted origin', () => {
  const targets = tracePropagationTargets('https://daisy.test');
  for (const [url, accepted] of [
    ['https://daisy.test/api/rooms', true],
    ['https://daisy.test.evil/api/rooms', false],
    ['https://daisyXtest/api/rooms', false],
    ['https://daisy.test:444/api/rooms', false],
    ['http://daisy.test/api/rooms', false],
    ['https://evil.test/?next=https://daisy.test/api/rooms', false],
  ] as const)
    assert({
      given: 'a trusted origin and a candidate outbound URL',
      should: 'admit only the complete origin boundary',
      actual: targets.some((target) => target.test(url)),
      expected: accepted,
    });
  for (const origin of [
    undefined,
    'invalid',
    'file:///tmp/a',
    'https://user:password@daisy.test',
    'https://daisy.test/path',
  ])
    assert({
      given: 'no valid trusted app origin',
      should: 'allow no propagation targets',
      actual: tracePropagationTargets(origin),
      expected: [],
    });
});
