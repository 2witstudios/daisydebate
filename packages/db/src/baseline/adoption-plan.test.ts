import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { planAdoption, type JournalRow } from './adoption-plan';

setupRitewayBun();

const stamp = (name: string, createdAt: number) => ({
  name,
  hash: name.slice(-1).repeat(64),
  createdAt,
});
const superseded = [stamp('20260101000000_a', 1), stamp('20260102000000_b', 2)];
const baseline = stamp('20260102000000_baseline', 2);
const imageLater = [stamp('20260103000000_c', 3), stamp('20260104000000_d', 4)];
const rows = (...stamps: ReturnType<typeof stamp>[]): JournalRow[] =>
  stamps.map((entry, index) => ({ id: index + 7, ...entry }));

describe('planAdoption', () => {
  const plan = (journal: readonly JournalRow[]) =>
    planAdoption({ journal, superseded, baseline, imageLater });

  test('swaps exactly the superseded rows and keeps the later ones', () => {
    assert({
      given: 'a journal of the superseded history and the first later folder',
      should:
        'delete the superseded ids, record the baseline in the first, and keep the later folder',
      actual: plan(rows(...superseded, imageLater[0]!)),
      expected: {
        ok: true,
        plan: {
          deleteIds: [7, 8],
          baselineId: 7,
          later: imageLater.slice(0, 1),
        },
      },
    });
  });

  test('refuses any journal that is not the superseded history plus image folders', () => {
    assert({
      given:
        'an adopted journal, a short history, a history with a changed hash, and an unknown later folder',
      should: 'refuse each, naming where it differs',
      actual: [
        plan(rows(baseline, ...imageLater)),
        plan(rows(superseded[0]!)),
        plan(rows(superseded[0]!, { ...superseded[1]!, hash: '0'.repeat(64) })),
        plan(rows(...superseded, stamp('20260109000000_x', 9))),
      ].map((result) => (result.ok ? 'planned' : result.refusal)),
      expected: [
        { kind: 'already-adopted' },
        {
          kind: 'history-differs',
          position: 1,
          expected: '20260102000000_b',
          found: null,
        },
        {
          kind: 'history-differs',
          position: 1,
          expected: '20260102000000_b',
          found: '20260102000000_b',
        },
        { kind: 'unknown-folder', position: 2, found: '20260109000000_x' },
      ],
    });
  });
});
