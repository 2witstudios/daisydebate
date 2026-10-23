import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  hasCompleteCaptureCoverage,
  requiredCoverage,
} from './capture-coverage';

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

test('required coverage starts at the first captured frame within the open tolerance (DEC-218)', () => {
  const required = (observed: readonly ReturnType<typeof range>[]) =>
    requiredCoverage({
      authority: [range(1000, 6000)],
      observed,
      tolerance: { openMs: 2000, closeMs: 0 },
    });
  assert({
    given:
      'a first frame inside the tolerance, at its edge, past it, none, and one only before the grant',
    should:
      'require from that frame inside the tolerance, else from grant open',
    actual: [
      required([range(4000, 6000), range(2500, 3900)]),
      required([range(3000, 6000)]),
      required([range(3001, 6000)]),
      required([]),
      required([range(500, 900)]),
    ],
    expected: [
      [range(2500, 6000)],
      [range(3000, 6000)],
      [range(1000, 6000)],
      [range(1000, 6000)],
      [range(1000, 6000)],
    ],
  });
});

test('required coverage ends at the last captured frame within the close tolerance (DEC-220)', () => {
  const required = (observed: readonly ReturnType<typeof range>[]) =>
    requiredCoverage({
      authority: [range(1000, 6000)],
      observed,
      tolerance: { openMs: 0, closeMs: 500 },
    });
  assert({
    given:
      'a last frame ending inside the tolerance, at its edge, before it, none, one past the close, and one ending before the interval opens',
    should:
      'require until that frame inside the tolerance, else until the close',
    actual: [
      required([range(1000, 3000), range(3000, 5800)]),
      required([range(1000, 5500)]),
      required([range(1000, 5499)]),
      required([]),
      required([range(1000, 6200)]),
      requiredCoverage({
        authority: [range(6000, 7000)],
        observed: [range(5000, 6000)],
        tolerance: { openMs: 0, closeMs: 1500 },
      }),
    ],
    expected: [
      [range(1000, 5800)],
      [range(1000, 5500)],
      [range(1000, 6000)],
      [range(1000, 6000)],
      [range(1000, 6000)],
      [range(6000, 7000)],
    ],
  });
});

test('a first frame never moves required coverage past its own window', () => {
  assert({
    given:
      'a short credited window whose only nearby frame belongs to the next window, and an open grant',
    should: 'keep the uncaptured window required from its start',
    actual: requiredCoverage({
      authority: [range(1000, 1500), range(1800, 3000), range(4000, null)],
      observed: [range(1800, 3000), range(4200, 4300)],
      tolerance: { openMs: 1000, closeMs: 0 },
    }),
    expected: [range(1000, 1500), range(1800, 3000), range(4200, null)],
  });
});
