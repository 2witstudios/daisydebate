import { assert, setupRitewayBun, test } from 'riteway/bun';
import { matchOperatorRoute, operatorCommandStateSchema } from './operator';

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

test('only the three operator routes match, each with its own method (ADR 0079)', () => {
  const id = 'a'.repeat(24);
  assert({
    given:
      'the list, beta access and command routes, a wrong method, a malformed id and an unknown path',
    should:
      'name the route and its id for each declared route, and nothing otherwise',
    actual: [
      matchOperatorRoute('GET', '/operator/v1/accounts'),
      matchOperatorRoute('PUT', `/operator/v1/accounts/${id}/beta-access`),
      matchOperatorRoute('GET', `/operator/v1/commands/${id}`),
      matchOperatorRoute('POST', '/operator/v1/accounts'),
      matchOperatorRoute('PUT', '/operator/v1/accounts/short/beta-access'),
      matchOperatorRoute('GET', '/operator/v1/accounts/extra'),
    ],
    expected: [
      { route: 'listAccounts', id: null },
      { route: 'setBetaAccess', id },
      { route: 'readCommand', id },
      null,
      null,
      null,
    ],
  });
});
