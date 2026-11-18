import type { LoadedConflictWaiverRequest } from '@daisy/db/tab';
import type { AuthorizationInput } from '@daisy/auth/authorization';
import type { ConfirmationCommand } from '@daisy/protocol/lobby/confirmation-command';
import { CommandDenied } from '../commands/run-command';

type Request = Extract<
  ConfirmationCommand,
  { readonly type: 'request-conflict-waiver' }
>;
/** A read waiver is assessed on that read's actual resource, with no waiver granted by the proposal itself. */
export function conflictWaiverAuthority(
  authority: Omit<AuthorizationInput, 'capability'>,
  capability: Request['capability'],
  observedRound: LoadedConflictWaiverRequest['observedRound'],
): Omit<AuthorizationInput, 'capability'> {
  if (capability === 'tournament.ballots.read_unreleased') return authority;
  if (authority.resource.kind !== 'fixture' || !observedRound)
    throw new CommandDenied('not-found');
  const fixture = authority.resource;
  return {
    ...authority,
    resource: {
      ...observedRound,
      owner: {
        kind: 'event',
        fixtureId: fixture.fixtureId,
        scope: fixture.scope,
        conflict: fixture.conflict,
        viewing: fixture.viewing,
        video: { minorSeated: false, guardianCap: 'officials' },
      },
    },
  };
}
