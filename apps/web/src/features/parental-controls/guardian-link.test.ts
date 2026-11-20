import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createdAccountLink,
  grantsGuardian,
  requestedLink,
  transitionGuardianLink,
  type GuardianLink,
  type GuardianLinkEvent,
} from './guardian-link';

setupRitewayBun();

const parent = 'p'.repeat(24);
const child = 'c'.repeat(24);
const stranger = 's'.repeat(24);
const at = '2026-11-19T12:00:00.000Z';
const later = '2026-11-20T12:00:00.000Z';
const people = {
  id: 'l'.repeat(24),
  guardianUserId: parent,
  minorUserId: child,
  guardianConsentId: 'e'.repeat(24),
};
const requested = requestedLink(people);
const confirmation = 'f'.repeat(24);
const active: GuardianLink = {
  ...people,
  version: 2,
  status: 'active',
  activation: { kind: 'child-confirmed', childConfirmationId: confirmation },
  activatedAt: at,
};
const created = createdAccountLink(people, at);
const refused: GuardianLink = {
  ...people,
  version: 2,
  status: 'refused',
  closedAt: at,
};
const cancelled: GuardianLink = { ...refused, status: 'cancelled' };
const ended: GuardianLink = {
  ...people,
  version: 3,
  status: 'ended',
  activation: { kind: 'created-account' },
  activatedAt: at,
  closedAt: later,
};

const confirm = (byUserId: string): GuardianLinkEvent => ({
  kind: 'confirm',
  byUserId,
  childConfirmationId: confirmation,
  at: later,
});
const event = (
  kind: 'refuse' | 'cancel' | 'end',
  byUserId: string,
): GuardianLinkEvent => ({ kind, byUserId, at: later });

const outcome = (link: GuardianLink, e: GuardianLinkEvent) => {
  const result = transitionGuardianLink(link, e);
  return result.kind === 'refused' ? result.refusal : result.link.status;
};

test('what a link grants', () => {
  assert({
    given: 'a link in each state',
    should: 'grant its guardian anything only while active',
    actual: [requested, active, created, refused, cancelled, ended].map(
      grantsGuardian,
    ),
    expected: [false, true, true, false, false, false],
  });
});

test('a parent-created account', () => {
  assert({
    given: 'the link written with an account the parent created',
    should: 'be active from creation, with no child confirmation',
    actual: created,
    expected: {
      ...people,
      version: 1,
      status: 'active',
      activation: { kind: 'created-account' },
      activatedAt: at,
    },
  });
});

test('the child answers a request', () => {
  assert({
    given: 'the child confirming a requested link',
    should: 'make it active, carrying the child’s confirmation',
    actual: transitionGuardianLink(requested, confirm(child)),
    expected: {
      kind: 'moved',
      link: {
        ...people,
        version: 2,
        status: 'active',
        activation: {
          kind: 'child-confirmed',
          childConfirmationId: confirmation,
        },
        activatedAt: later,
      },
    },
  });
  assert({
    given: 'the child saying it is not their parent',
    should: 'close the request as refused',
    actual: transitionGuardianLink(requested, event('refuse', child)),
    expected: {
      kind: 'moved',
      link: { ...people, version: 2, status: 'refused', closedAt: later },
    },
  });
  assert({
    given: 'the parent confirming or refusing on the child’s behalf',
    should: 'refuse as not found: only the child answers',
    actual: [
      outcome(requested, confirm(parent)),
      outcome(requested, event('refuse', parent)),
    ],
    expected: ['not-found', 'not-found'],
  });
});

test('the parent withdraws or ends', () => {
  assert({
    given: 'the parent cancelling a request',
    should: 'close it as cancelled',
    actual: outcome(requested, event('cancel', parent)),
    expected: 'cancelled',
  });
  assert({
    given: 'the parent ending an active link of either activation',
    should: 'end it, keeping how it became active',
    actual: [
      transitionGuardianLink(active, event('end', parent)),
      outcome(created, event('end', parent)),
    ],
    expected: [
      {
        kind: 'moved',
        link: {
          ...people,
          version: 3,
          status: 'ended',
          activation: {
            kind: 'child-confirmed',
            childConfirmationId: confirmation,
          },
          activatedAt: at,
          closedAt: later,
        },
      },
      'ended',
    ],
  });
  assert({
    given: 'the child cancelling or ending',
    should: 'refuse as not found',
    actual: [
      outcome(requested, event('cancel', child)),
      outcome(active, event('end', child)),
    ],
    expected: ['not-found', 'not-found'],
  });
});

test('every state against every event', () => {
  const states = { requested, active, created, refused, cancelled, ended };
  const events = {
    confirm: confirm(child),
    refuse: event('refuse', child),
    cancel: event('cancel', parent),
    end: event('end', parent),
  };
  const matrix = Object.fromEntries(
    Object.entries(states).map(([name, link]) => [
      name,
      Object.fromEntries(
        Object.entries(events).map(([kind, e]) => [kind, outcome(link, e)]),
      ),
    ]),
  );
  assert({
    given: 'each state and each event from its rightful person',
    should: 'move only along the link’s life and refuse every other step',
    actual: matrix,
    expected: {
      requested: {
        confirm: 'active',
        refuse: 'refused',
        cancel: 'cancelled',
        end: 'not-active',
      },
      active: {
        confirm: 'not-waiting',
        refuse: 'not-waiting',
        cancel: 'not-waiting',
        end: 'ended',
      },
      created: {
        confirm: 'not-waiting',
        refuse: 'not-waiting',
        cancel: 'not-waiting',
        end: 'ended',
      },
      refused: {
        confirm: 'not-waiting',
        refuse: 'not-waiting',
        cancel: 'not-waiting',
        end: 'not-active',
      },
      cancelled: {
        confirm: 'not-waiting',
        refuse: 'not-waiting',
        cancel: 'not-waiting',
        end: 'not-active',
      },
      ended: {
        confirm: 'not-waiting',
        refuse: 'not-waiting',
        cancel: 'not-waiting',
        end: 'not-active',
      },
    },
  });
  assert({
    given: 'a stranger sending any event to any link',
    should: 'refuse every one as not found',
    actual: Object.values(states).flatMap((link) =>
      (['confirm', 'refuse', 'cancel', 'end'] as const).map((kind) =>
        outcome(
          link,
          kind === 'confirm' ? confirm(stranger) : event(kind, stranger),
        ),
      ),
    ),
    expected: Array.from({ length: 24 }, () => 'not-found'),
  });
});
