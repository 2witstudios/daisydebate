import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  canonicalAuditJson,
  chainNext,
  GENESIS_HASH,
  genesisAnchor,
  verifyAuditChain,
  type AuditEvent,
  type AuditRow,
} from './chain';
import { sha3 } from '../auth/secrets';

setupRitewayBun();
const event = (id: string, at: string): AuditEvent => ({
  id,
  kind: 'auth.success',
  operatorId: 'operator1',
  commandId: null,
  targetUserId: null,
  outcome: null,
  detail: null,
  at,
});
const build = (count: number): AuditRow[] => {
  const rows: AuditRow[] = [];
  let head = genesisAnchor;
  for (let index = 1; index <= count; index += 1) {
    const row = chainNext(
      head,
      event(`e${index}`, `2026-10-26T12:00:0${index}.000Z`),
    );
    rows.push(row);
    head = row;
  }
  return rows;
};

test('genesis and canonical form', () => {
  const [first] = build(1);
  assert({
    given: 'the chain version label',
    should: 'derive the genesis as its SHA3-256',
    actual: GENESIS_HASH,
    expected: sha3('daisy-admin-audit-v1'),
  });
  assert({
    given: 'the first row',
    should: 'link to genesis and hash prev_hash ‖ sorted-key JSON',
    actual: [
      first?.seq,
      first?.prevHash === GENESIS_HASH,
      first?.hash ===
        sha3(`${GENESIS_HASH}${canonicalAuditJson(first as AuditRow)}`),
      Object.keys(JSON.parse(canonicalAuditJson(first as AuditRow))),
    ],
    expected: [
      1,
      true,
      true,
      [
        'at',
        'commandId',
        'detail',
        'id',
        'kind',
        'operatorId',
        'outcome',
        'prevHash',
        'seq',
        'targetUserId',
      ],
    ],
  });
  assert({
    given: 'the same instant read back from the database as a Date string',
    should: 'serialize identically',
    actual:
      canonicalAuditJson({
        ...(first as AuditRow),
        at: 'Mon, 26 Oct 2026 12:00:01 GMT',
      }) === canonicalAuditJson(first as AuditRow),
    expected: true,
  });
});

test('verifyAuditChain', () => {
  const rows = build(4);
  assert({
    given: 'an intact chain',
    should: 'be consistent over seq 1–N',
    actual: verifyAuditChain(rows, genesisAnchor),
    expected: { status: 'consistent', first: 1, last: 4 },
  });
  assert({
    given: 'no rows',
    should: 'be empty',
    actual: verifyAuditChain([], genesisAnchor),
    expected: { status: 'empty' },
  });
  const edited = rows.map((row) =>
    row.seq === 2 ? { ...row, kind: 'auth.failure' as const } : row,
  );
  assert({
    given: 'a row edited in place',
    should: 'break at that row',
    actual: verifyAuditChain(edited, genesisAnchor),
    expected: { status: 'broken', seq: 2, reason: 'hash' },
  });
  const rehashed = rows.map((row) =>
    row.seq === 2
      ? chainNext(rows[0] as AuditRow, { ...row, outcome: 'x' })
      : row,
  );
  assert({
    given: 'a row edited and rehashed without rewriting its successors',
    should: 'break at the next link',
    actual: verifyAuditChain(rehashed, genesisAnchor),
    expected: { status: 'broken', seq: 3, reason: 'link' },
  });
  assert({
    given: 'a row deleted from the middle',
    should: 'report the gap',
    actual: verifyAuditChain(
      rows.filter(({ seq }) => seq !== 2),
      genesisAnchor,
    ),
    expected: { status: 'broken', seq: 3, reason: 'gap' },
  });
  const head = rows[3] as AuditRow;
  assert({
    given: 'a truncated tail against a recorded head',
    should: 'report the truncation',
    actual: verifyAuditChain(rows.slice(0, 2), genesisAnchor, [head]),
    expected: { status: 'truncated', expectedSeq: 4 },
  });
  assert({
    given: 'a recorded head whose hash differs from the row now at that seq',
    should: 'break at that seq',
    actual: verifyAuditChain(rows, genesisAnchor, [
      { seq: 4, hash: 'f'.repeat(64) },
    ]),
    expected: { status: 'broken', seq: 4, reason: 'hash' },
  });
  assert({
    given: 'a pruned chain verified from its checkpoint',
    should: 'be consistent over the retained range',
    actual: verifyAuditChain(rows.slice(2), rows[1] as AuditRow),
    expected: { status: 'consistent', first: 3, last: 4 },
  });
});
