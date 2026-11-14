import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decideConfirm,
  decideConflictWaiver,
  decideSettle,
  type ConfirmFacts,
  type ConflictWaiverFacts,
  type PendingCommandRow,
} from './confirmation';
import type { CommandDecision } from './run-command';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const now = '2026-11-14T10:00:00.000Z';
const pending: PendingCommandRow = {
  commandId: id('p'),
  lobbyId: id('l'),
  proposerUserId: id('u'),
  type: 'assign-judge',
  payloadDigest: 'a'.repeat(64),
  expected: { fixture: 4 },
  conflictId: id('k'),
  status: 'pending',
  expiresAt: '2026-11-14T11:00:00.000Z',
};
type Write = { readonly table: 'fixture_judges'; readonly op: 'insert' };
const rerun: CommandDecision<'panel-full', Write> = {
  kind: 'accepted',
  aggregate: { kind: 'fixture', id: id('f') },
  resultingVersion: 5,
  writes: [{ table: 'fixture_judges', op: 'insert' }],
  findings: [],
  fixtureChanges: [],
};
const facts: ConfirmFacts<'panel-full', Write> = {
  now,
  settlerUserId: id('c'),
  pending,
  proposer: { id: id('u'), deletedAt: null },
  proposerAuthorization: {
    allow: true,
    authority: { kind: 'grant', grantId: id('g') },
  },
  scope: { kind: 'lobby', lobbyId: id('l') },
  versions: ['fixture'],
  current: { fixture: 4 },
  rerun,
};
const confirm = { type: 'confirm-command', pendingCommandId: id('p') } as const;

const refusalOf = (decision: { kind: string; refusal?: string }) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';

test('confirming a pending command', () => {
  const decision = decideConfirm(facts, confirm);
  assert({
    given:
      'a pending command whose proposer still may send it, at current versions',
    should:
      'settle it, apply the stored decision and write its history naming proposer and confirmer',
    actual: decision.kind === 'accepted' ? decision.writes : decision,
    expected: [
      {
        table: 'pending_commands',
        op: 'update',
        commandId: id('p'),
        set: { status: 'confirmed', settledAt: now, settledByUserId: id('c') },
      },
      { table: 'fixture_judges', op: 'insert' },
      {
        table: 'action_history',
        op: 'insert',
        entry: {
          commandId: id('p'),
          scope: { kind: 'lobby', lobbyId: id('l') },
          aggregate: { kind: 'fixture', id: id('f') },
          type: 'assign-judge',
          actorUserId: id('u'),
          authority: { kind: 'grant', grantId: id('g') },
          conflictId: id('k'),
          confirmedByUserId: id('c'),
          payloadDigest: 'a'.repeat(64),
          resultingVersion: 5,
          appliedAt: now,
        },
      },
    ],
  });
  assert({
    given: 'a proposer who has since closed their account',
    should: 'refuse proposer-closed and apply nothing',
    actual: decideConfirm(
      {
        ...facts,
        proposer: { id: id('u'), deletedAt: '2026-11-14T09:30:00.000Z' },
      },
      confirm,
    ),
    expected: { kind: 'refused', refusal: 'proposer-closed' },
  });
  assert({
    given: 'each other reason a confirmation cannot apply',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideConfirm(
          { ...facts, proposerAuthorization: { allow: false } },
          confirm,
        ),
      ),
      refusalOf(
        decideConfirm(
          { ...facts, pending: { ...pending, status: 'declined' } },
          confirm,
        ),
      ),
      refusalOf(
        decideConfirm({ ...facts, now: '2026-11-14T11:00:00.000Z' }, confirm),
      ),
      refusalOf(decideConfirm({ ...facts, current: { fixture: 5 } }, confirm)),
      refusalOf(
        decideConfirm(
          { ...facts, rerun: { kind: 'refused', refusal: 'panel-full' } },
          confirm,
        ),
      ),
    ],
    expected: [
      'proposer-unauthorized',
      'pending-settled',
      'pending-expired',
      'version-conflict',
      'panel-full',
    ],
  });
});

test('declining and withdrawing', () => {
  const decline = {
    type: 'decline-command',
    pendingCommandId: id('p'),
  } as const;
  const withdraw = {
    type: 'withdraw-command',
    pendingCommandId: id('p'),
  } as const;
  const declined = decideSettle(facts, decline);
  assert({
    given: 'a decline',
    should: 'settle the pending command and apply nothing',
    actual: declined.kind === 'accepted' ? declined.writes : declined,
    expected: [
      {
        table: 'pending_commands',
        op: 'update',
        commandId: id('p'),
        set: { status: 'declined', settledAt: now, settledByUserId: id('c') },
      },
    ],
  });
  assert({
    given: 'a withdrawal by the proposer, and either on a settled command',
    should: 'settle it withdrawn, or refuse pending-settled',
    actual: [
      (() => {
        const outcome = decideSettle(
          { ...facts, settlerUserId: id('u') },
          withdraw,
        );
        return outcome.kind === 'accepted'
          ? outcome.writes[0]?.set.status
          : outcome;
      })(),
      refusalOf(
        decideSettle(
          { ...facts, pending: { ...pending, status: 'lapsed' } },
          decline,
        ),
      ),
      refusalOf(
        decideSettle(
          { ...facts, pending: { ...pending, status: 'confirmed' } },
          withdraw,
        ),
      ),
    ],
    expected: ['withdrawn', 'pending-settled', 'pending-settled'],
  });
});

test('a conflict waiver', () => {
  const conflict = {
    id: id('k'),
    lobbyId: id('l'),
    userId: id('u'),
    fixtureId: id('f'),
    basis: 'school_entry',
    handling: 'second_confirms',
    confirmedByUserId: null,
  } as const;
  const waiverFacts: ConflictWaiverFacts = {
    now,
    mintedConflictId: id('w'),
    confirmerUserId: id('c'),
    conflict,
    waiverHolds: false,
  };
  const request = {
    type: 'request-conflict-waiver',
    fixtureId: id('f'),
    capability: 'tournament.ballots.read_unreleased',
  } as const;
  const confirmed = decideConflictWaiver(waiverFacts, request);
  assert({
    given: 'a confirmed waiver request',
    should: 'write the waiver: a new conflict row carrying the confirmer',
    actual: confirmed.kind === 'accepted' ? confirmed.writes : confirmed,
    expected: [
      {
        table: 'conflicts',
        op: 'insert',
        row: {
          id: id('w'),
          lobbyId: id('l'),
          userId: id('u'),
          fixtureId: id('f'),
          basis: 'school_entry',
          handling: 'second_confirms',
          confirmedByUserId: id('c'),
          detectedAt: now,
        },
      },
    ],
  });
  assert({
    given:
      'a waiver that already holds, or a conflict that is not confirmed by a second person',
    should: 'refuse it by name',
    actual: [
      refusalOf(
        decideConflictWaiver({ ...waiverFacts, waiverHolds: true }, request),
      ),
      refusalOf(
        decideConflictWaiver(
          { ...waiverFacts, conflict: { ...conflict, handling: 'flagged' } },
          request,
        ),
      ),
      refusalOf(
        decideConflictWaiver({ ...waiverFacts, conflict: null }, request),
      ),
    ],
    expected: [
      'waiver-exists',
      'handling-not-confirming',
      'handling-not-confirming',
    ],
  });
});
