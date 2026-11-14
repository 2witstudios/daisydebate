import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SanctionCommand } from '@daisy/protocol/lobby/sanction-command';
import {
  decideRequestSanction,
  decideSettleSanction,
  type RequestSanctionFacts,
  type SettledSanctionFacts,
} from './sanction';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const now = '2026-11-14T10:00:00.000Z';
const pins = { formatVersionId: id('1'), ballotDefinitionVersionId: id('2') };
type Check = RequestSanctionFacts['check'];
/** Only the enforced key is read by the check; the rest of the chain is not needed here. */
const resolved = (value: 'second_confirms' | 'flagged') =>
  ({
    'conflict.handling': { value: { value } },
  }) as unknown as Check['event']['resolved'];
const agreeing: Check = {
  template: {
    ...pins,
    enforced: [
      { key: 'conflict.handling', value: { value: 'second_confirms' } },
    ],
  },
  event: { ...pins, resolved: resolved('second_confirms') },
};
const disagreeing: Check = {
  ...agreeing,
  event: { ...pins, resolved: resolved('flagged') },
};

const request: Extract<SanctionCommand, { type: 'request-sanction' }> = {
  type: 'request-sanction',
  leagueId: id('l'),
  eventId: id('v'),
  templateId: id('t'),
  seasonId: id('s'),
};
const requestFacts: RequestSanctionFacts = {
  now,
  mintedSanctionId: id('n'),
  event: { id: id('v'), lobbyId: id('b') },
  template: { id: id('t'), organizationId: id('l') },
  season: { id: id('s'), organizationId: id('l') },
  existing: null,
  check: agreeing,
};
const sanction = {
  id: id('n'),
  organizationId: id('l'),
  lobbyId: id('b'),
  eventId: id('v'),
  seasonId: id('s'),
  templateId: id('t'),
  status: 'requested',
  version: 1,
} as const;
const settledFacts: SettledSanctionFacts = {
  now,
  sanction,
  check: agreeing,
  eventCertified: false,
};

const refusalOf = (decision: { kind: string; refusal?: string }) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';

test('requesting a sanction', () => {
  const decision = decideRequestSanction(requestFacts, request);
  assert({
    given: 'a request whose event agrees with the template',
    should: 'insert a requested sanction',
    actual: decision.kind === 'accepted' ? decision.writes : decision,
    expected: [
      {
        table: 'sanctions',
        op: 'insert',
        row: {
          id: id('n'),
          organizationId: id('l'),
          lobbyId: id('b'),
          eventId: id('v'),
          seasonId: id('s'),
          templateId: id('t'),
          status: 'requested',
          version: 1,
        },
      },
    ],
  });
  assert({
    given: 'each reason a request is refused',
    should: 'refuse it by name, the mismatch with no comparison',
    actual: [
      decideRequestSanction(
        { ...requestFacts, existing: { ...sanction, status: 'declined' } },
        request,
      ),
      decideRequestSanction(
        { ...requestFacts, template: { id: id('t'), organizationId: id('o') } },
        request,
      ),
      decideRequestSanction(
        { ...requestFacts, season: { id: id('s'), organizationId: id('o') } },
        request,
      ),
      decideRequestSanction({ ...requestFacts, check: disagreeing }, request),
      decideRequestSanction(requestFacts, { ...request, eventId: id('w') }),
    ],
    expected: [
      { kind: 'refused', refusal: 'already-requested' },
      { kind: 'refused', refusal: 'template-foreign' },
      { kind: 'refused', refusal: 'season-foreign' },
      { kind: 'refused', refusal: 'template-mismatch' },
      { kind: 'refused', refusal: 'not-found' },
    ],
  });
});

test('settling a sanction', () => {
  const approve = { type: 'approve-sanction', sanctionId: id('n') } as const;
  const decline = { type: 'decline-sanction', sanctionId: id('n') } as const;
  const withdraw = {
    type: 'withdraw-sanction',
    sanctionId: id('n'),
    reason: 'Moved season',
  } as const;
  const approved = decideSettleSanction(settledFacts, approve);
  assert({
    given: 'an approval while the check still passes',
    should: 'approve it and bump its version',
    actual:
      approved.kind === 'accepted'
        ? [approved.resultingVersion, approved.writes]
        : approved,
    expected: [
      2,
      [
        {
          table: 'sanctions',
          op: 'update',
          id: id('n'),
          set: {
            status: 'approved',
            decidedAt: now,
            version: 2,
            updatedAt: now,
          },
        },
      ],
    ],
  });
  const approvedFacts = {
    ...settledFacts,
    sanction: { ...sanction, status: 'approved' as const },
  };
  assert({
    given: 'each settlement in each sanction state',
    should: 'run the check again on approval and refuse a settled one',
    actual: [
      refusalOf(
        decideSettleSanction({ ...settledFacts, check: disagreeing }, approve),
      ),
      refusalOf(decideSettleSanction(approvedFacts, approve)),
      refusalOf(decideSettleSanction(approvedFacts, decline)),
      refusalOf(decideSettleSanction(settledFacts, decline)),
      refusalOf(decideSettleSanction(approvedFacts, withdraw)),
      refusalOf(
        decideSettleSanction(
          { ...approvedFacts, eventCertified: true },
          withdraw,
        ),
      ),
      refusalOf(
        decideSettleSanction(
          { ...settledFacts, sanction: { ...sanction, status: 'withdrawn' } },
          withdraw,
        ),
      ),
    ],
    expected: [
      'template-mismatch',
      'sanction-settled',
      'sanction-settled',
      'accepted',
      'accepted',
      'results-certified',
      'sanction-settled',
    ],
  });
});
