import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleTrace } from './trace-sampling';
setupRitewayBun();

test('routine traffic never samples, even with an upstream sampled parent', () => {
  for (const context of [
    { name: 'attendance.check-in' },
    { name: 'POST /api/rounds/[roundId]/check-in' },
    {
      name: 'middleware POST',
      normalizedRequest: {
        url: 'https://daisy.test/api/rounds/abc/check-in?q=x',
      },
    },
    {
      name: 'request',
      attributes: { 'url.full': 'https://daisy.test/api/health/ready' },
    },
    { name: 'GET /health/live' },
  ])
    assert({
      given: 'routine route or standalone operation with parentSampled=true',
      should: 'exclude it before recording',
      actual: sampleTrace({ ...context, parentSampled: true }),
      expected: 0,
    });
});

test('unrecognized and ordinary traffic have a local bound independent of parents', () => {
  for (const parentSampled of [undefined, true, false])
    assert({
      given: 'an ordinary or unknown root shape with any parent decision',
      should: 'apply the explicit local one-percent rate',
      actual: sampleTrace({ name: 'GET /rooms', parentSampled }),
      expected: 0.01,
    });
});
