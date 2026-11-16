import { assert, setupRitewayBun, test } from 'riteway/bun';
import { classifyCadencePair } from './media-cadence-pair.test-support';
setupRitewayBun();

test('a paired control failure never becomes a product cadence pass', () => {
  assert({
    given:
      'control failure, writer-only delay, no reproduced failure, or invalid samples',
    should:
      'retain the strict60ms boundary and classify evidence without claiming product PASS',
    actual: [
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 10,
        controlMaxGapMs: 60,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 60,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: 59.9,
        controlMaxGapMs: 59.9,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: false,
        writerMaxGapMs: 10,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: false,
        controlOnTime: true,
        writerMaxGapMs: 10,
        controlMaxGapMs: 10,
      }),
      classifyCadencePair({
        writerOnTime: true,
        controlOnTime: true,
        writerMaxGapMs: NaN,
        controlMaxGapMs: 10,
      }),
    ],
    expected: [
      'environmental-or-inconclusive',
      'writer-delay-not-explained-by-control',
      'no-failure-observed',
      'environmental-or-inconclusive',
      'writer-delay-not-explained-by-control',
      'inconclusive',
    ],
  });
});
