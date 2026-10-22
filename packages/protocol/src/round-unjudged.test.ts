import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundUnjudgedReceiptSchema } from './round-unjudged';
import { roundCommandEnvelopeSchema } from './round-command';
setupRitewayBun();
const receipt = {
  version: 1,
  commandId: 'c'.repeat(24),
  roundId: 'r'.repeat(24),
  freezeRevision: 1,
  resultingVersion: 2,
  status: 'completed',
  ruling: 'unjudged',
  outcome: null,
  noRuling: [],
  replayed: false,
};
test('unjudged receipts describe only the original frozen completion and its ruling', () => {
  for (const [input, expected] of [
    [receipt, true],
    [{ ...receipt, replayed: true }, true],
    [
      {
        ...receipt,
        ruling: 'judges-did-not-rule',
        noRuling: ['j'.repeat(24)],
      },
      true,
    ],
    [
      {
        ...receipt,
        ruling: 'partial',
        outcome: 'draw',
        noRuling: ['j'.repeat(24)],
      },
      true,
    ],
    [{ ...receipt, outcome: 'abstain' }, false],
    [{ ...receipt, ruling: 'forfeit' }, false],
    [{ ...receipt, noRuling: ['not-an-id'] }, false],
    [{ ...receipt, freezeRevision: 0 }, false],
    [{ ...receipt, resultingVersion: 0 }, false],
    [{ ...receipt, status: 'abandoned' }, false],
    [{ ...receipt, version: 2 }, false],
    [{ ...receipt, judgeId: 'j'.repeat(24) }, false],
  ] as const)
    assert({
      given: JSON.stringify(input),
      should: 'validate the durable receipt strictly',
      actual: roundUnjudgedReceiptSchema.safeParse(input).success,
      expected,
    });
  assert({
    given: 'an untrusted public completion command',
    should: 'refuse caller-selected unjudged completion',
    actual: roundCommandEnvelopeSchema.safeParse({
      version: 1,
      commandId: receipt.commandId,
      expectedVersion: 1,
      command: { type: 'complete', outcome: null },
    }).success,
    expected: false,
  });
});
