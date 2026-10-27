import { assert, setupRitewayBun, test } from 'riteway/bun';
import { operatorCommandStateSchema } from './operator';

setupRitewayBun();

const result = {
  commandId: 'c'.repeat(24),
  outcome: 'changed',
  accessState: 'approved',
  accessRevision: 2,
  mail: 'queued',
};

test('a reconciled command state is a closed contract (ADR 0079)', () => {
  const parses = (value: unknown) =>
    operatorCommandStateSchema.safeParse(value).success;
  assert({
    given:
      'a stored result with queued mail, with no mail owed, with an unknown mail state and with an extra field',
    should: 'accept only the declared shape and mail states',
    actual: [
      parses({ result, mailState: 'queued' }),
      parses({ result, mailState: null }),
      parses({ result, mailState: 'bounced' }),
      parses({ result, mailState: null, operator: 'o' }),
    ],
    expected: [true, true, false, false],
  });
});
