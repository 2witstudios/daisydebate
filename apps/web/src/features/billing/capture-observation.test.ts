import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeCaptureIntervals } from './capture-observation.test-support';
setupRitewayBun();

test('capture volume and overlap remain independent for sequential and overlapping actual transport intervals', () => {
  assert({
    given: 'two complete sequential intervals or the same volume overlapping',
    should: 'measure equal volume but different independently observed peak',
    actual: [
      observeCaptureIntervals([
        { began: 1, ended: 3 },
        { began: 3, ended: 5 },
      ]),
      observeCaptureIntervals([
        { began: 1, ended: 4 },
        { began: 2, ended: 5 },
      ]),
    ],
    expected: [
      { complete: true, completed: 2, peak: 1, active: 0 },
      { complete: true, completed: 2, peak: 2, active: 0 },
    ],
  });
});
test('unfinished or invalid intervals cannot manufacture complete capture measurement', () => {
  assert({
    given: 'an unfinished capture or reversed/nonfinite transport time',
    should: 'retain unknown or active instead of a completed zero',
    actual: [
      observeCaptureIntervals([{ began: 1, ended: null }]),
      observeCaptureIntervals([{ began: 2, ended: 1 }]),
      observeCaptureIntervals([{ began: NaN, ended: 3 }]),
    ],
    expected: [
      { complete: false, completed: 0, peak: 1, active: 1 },
      { complete: false, completed: null, peak: null, active: null },
      { complete: false, completed: null, peak: null, active: null },
    ],
  });
});
