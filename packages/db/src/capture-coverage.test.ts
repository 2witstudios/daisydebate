import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hasCompleteCaptureCoverage } from './capture-coverage';

setupRitewayBun();
const range = (start: number, end: number | null) => ({ start, end });
const closed = {
  required: [range(1000, 2000), range(3000, 4000)],
  observed: [range(500, 1500), range(1500, 2500), range(2900, 4100)],
  storedChunks: 2,
  expectedChunks: 2,
};

test('a seal requires every closed historical grant and matching committed chunks', () => {
  assert({
    given: 'adjacent observations spanning all grants with actual chunk counts',
    should: 'seal complete only when no grant, coverage or chunk is missing',
    actual: [
      closed,
      { ...closed, observed: [range(500, 1499), range(1500, 4100)] },
      { ...closed, expectedChunks: 3 },
      { ...closed, required: [range(1000, null)] },
      { ...closed, required: [] },
      { ...closed, observed: [range(500, 2500)] },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false, false],
  });
});

test('overlapping unordered observations cover silence without inventing empty grant authority', () => {
  assert({
    given: 'zero-length provenance plus a real grant with no recognized speech',
    should: 'allow complete silent coverage but refuse malformed evidence',
    actual: [
      {
        ...closed,
        required: [range(1000, 1000), range(2000, 3000)],
        observed: [range(2500, 3100), range(1900, 2600)],
        storedChunks: 0,
        expectedChunks: 0,
      },
      { ...closed, required: [range(1000, 1000)] },
      { ...closed, observed: [range(500, null)] },
      { ...closed, observed: [range(500, Number.NaN)] },
      { ...closed, storedChunks: -1, expectedChunks: -1 },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false],
  });
});
