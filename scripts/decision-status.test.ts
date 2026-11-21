import { describe, expect, test } from 'bun:test';
import {
  overruledCitations,
  retiredAdr,
  snapshotDecisionList,
} from './decision-status';

describe('source decision citations', () => {
  const retired = new Set(['DEC-900001', 'ADR 9990']);

  test('rejects retired DEC and ADR references in source and reports their lines', () => {
    const source = [
      '// DEC-900001 is the input contract',
      '// see ADR #9990, ADR-9990 and docs/decisions/9990-former.md',
      '// these nearby DEC-9000012 and ADR 9991 references have different numbers',
    ].join('\n');
    expect(
      overruledCitations('apps/web/src/example.ts', source, retired),
    ).toEqual([
      {
        path: 'apps/web/src/example.ts',
        line: 1,
        rule: 'overruled-decision',
        detail: 'DEC-900001 is retired; cite the decision currently in force',
      },
      {
        path: 'apps/web/src/example.ts',
        line: 2,
        rule: 'overruled-decision',
        detail: 'ADR 9990 is retired; cite the decision currently in force',
      },
    ]);
  });

  test('retains migration history and accepted ADRs with partial amendments', () => {
    expect(
      overruledCitations(
        'packages/db/migrations/old/migration.sql',
        '-- DEC-900001',
        retired,
      ),
    ).toEqual([]);
    const path = 'docs/decisions/9990-former.md';
    expect(
      retiredAdr(path, 'Status: accepted; one section superseded'),
    ).toBeUndefined();
    expect(retiredAdr(path, 'Status: superseded by another ADR')).toBe(
      'ADR 9990',
    );
  });

  test('keeps board decisions by disposition and rejects unknown statuses or duplicate IDs', () => {
    expect(
      snapshotDecisionList({
        tasks: [
          { title: 'DEC-900042 — Retired', status: 'overruled' },
          { title: 'DEC-900007 — Agreed', status: 'confirmed' },
          { title: 'DEC-900010 — Open', status: 'pending' },
        ],
      }),
    ).toEqual({
      version: 1,
      decisions: {
        'DEC-900007': 'confirmed',
        'DEC-900010': 'pending',
        'DEC-900042': 'overruled',
      },
    });
    expect(() =>
      snapshotDecisionList({
        tasks: [{ title: 'DEC-900007 — Example', status: 'typo' }],
      }),
    ).toThrow('Unknown status');
    expect(() =>
      snapshotDecisionList({
        tasks: [
          { title: 'DEC-900007 — Example', status: 'confirmed' },
          { title: 'DEC-900007 — Duplicate', status: 'confirmed' },
        ],
      }),
    ).toThrow('Duplicate DEC');
  });
});
