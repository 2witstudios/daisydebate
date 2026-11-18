import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { ageBand, type AgeBand } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { ContactAuthorizationFence } from '@daisy/db/contacts';
import { challengeSendFence } from './send-fence';

setupRitewayBun();

const me = 'a'.repeat(24);
const them = 'b'.repeat(24);
const principal = {
  kind: 'user',
  userId: me,
  actorId: me,
} as unknown as AuthorizationPrincipal;
const account = (actorId: string, band: AgeBand | null) => ({
  userId: actorId,
  actorId,
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: band,
  restricted: false,
});
// The fence reads bands computed on the send's instant; these are the
// birth months either side of 18 on it.
const sentAt = new Date('2026-11-17T12:00:00.000Z');
const seventeenElevenMonths = ageBand('2008-12', sentAt);
const exactlyEighteen = ageBand('2008-11', sentAt);

const send = (
  mode: 'ranked' | 'casual',
  bands: { readonly mine: AgeBand | null; readonly theirs: AgeBand | null },
) =>
  challengeSendFence({ principal, mode })(
    {} as Parameters<ContactAuthorizationFence>[0],
    { userId: me, actorId: me, memberActorIds: [me, them] },
    {
      contacts: [
        { lowActorId: me, highActorId: them, blocked: false, revision: 1 },
      ],
      accounts: [account(me, bands.mine), account(them, bands.theirs)],
    },
  );

test('a ranked offer needs the sender at the ranked age floor', async () => {
  await assertRejects({
    given: 'a ranked offer from a member aged 17 years 11 months',
    should: 'refuse on their own age',
    code: 'CONFLICT',
    actual: () =>
      send('ranked', { mine: seventeenElevenMonths, theirs: 'adult' }),
  });
  assert({
    given: 'a ranked offer from a member who turns 18 this month',
    should: 'pass the fence',
    actual: await send('ranked', { mine: exactlyEighteen, theirs: 'adult' }),
    expected: undefined,
  });
  assert({
    given: 'a casual offer from a 16-17 member',
    should: 'pass the fence: casual play stays open to them',
    actual: await send('casual', { mine: '16-17', theirs: 'adult' }),
    expected: undefined,
  });
  assert({
    given: 'a ranked offer from an adult to a 16-17 member',
    should:
      'pass the fence: their age is not the sender’s to learn, and their own Accept refuses',
    actual: await send('ranked', { mine: 'adult', theirs: '16-17' }),
    expected: undefined,
  });
});
