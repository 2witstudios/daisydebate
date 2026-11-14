import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import {
  allowRelated,
  allowUnder,
  deny,
  type AuthorizationDecision,
} from './authorization-decision';
import {
  holdingDecision,
  holds,
  hostAuthority,
  type Holder,
} from './authorization-holding';
import {
  adultRelation,
  authorityDecision as under,
  lobbyTarget as lobby,
  organizationTarget as organization,
  type ResourceOf as Of,
} from './authorization-permission';
import { audienceDecision } from './authorization-audience';
import { conflictOf } from './authorization-conflict';

/** Decides a capability on another resource, for a command awaiting confirmation. */
export type DecideOn = (
  capability: AuthorizationCapability,
  resource: Of<'pending_command'>['target'],
) => AuthorizationDecision;

/**
 * An entry is its responsible adult's: whoever manages the school's roster,
 * the guardian, or an adult entered for themselves. Tab staff who manage
 * entries may act on any of them.
 */
export function entryDecision(
  holder: Holder,
  resource: Of<'entry'>,
): AuthorizationDecision {
  const responsible = resource.responsible;
  const own =
    responsible.kind === 'school'
      ? holdingDecision(
          holds(
            holder,
            'school.roster.manage',
            organization(responsible.school),
          ),
        )
      : responsible.kind === 'guardian'
        ? adultRelation(
            holder,
            responsible.guardianActorId === holder.actorId,
            'responsible_adult',
          )
        : adultRelation(holder, responsible.actorId === holder.actorId, 'self');
  if (own.allow) return own;
  const staff = holdingDecision(
    holds(holder, 'tournament.entries.manage', lobby(resource.scope)),
  );
  return staff.allow || own.reason !== 'age-band' ? staff : own;
}

export function judgeDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'judge'>,
): AuthorizationDecision {
  if (resource.actorId === holder.actorId) return allowRelated('self');
  return capability === 'judge.availability.update'
    ? holdingDecision(
        holds(holder, 'tournament.entries.manage', lobby(resource.scope)),
      )
    : deny('missing-capability');
}

/** A released resolution is read with the posting; an unreleased one by permission. */
export function resolutionDecision(
  holder: Holder,
  resource: Of<'tab_round'>,
): AuthorizationDecision {
  const posted = resource.resolutionReleased
    ? audienceDecision(
        holder,
        resource.scope,
        'posting',
        resource.viewing,
        null,
      )
    : deny('missing-capability');
  return posted.allow
    ? posted
    : holdingDecision(
        holds(
          holder,
          'tournament.resolutions.read_unreleased',
          lobby(resource.scope),
        ),
      );
}

/**
 * Confirming needs a second person: not the proposer, holding the held
 * command's capability on its resource, with no connection to it. Only the
 * proposer withdraws.
 */
export function pendingCommandDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'pending_command'>,
  decideOn: DecideOn,
): AuthorizationDecision {
  const proposer = resource.proposerActorId === holder.actorId;
  if (capability === 'command.withdraw')
    return proposer ? allowRelated('proposer') : deny('missing-capability');
  if (proposer) return deny('missing-capability');
  const held = decideOn(resource.capability, resource.target);
  if (!held.allow) return held;
  return held.conflict === null
    ? allowUnder(held.authority)
    : deny('conflict', held.conflict);
}

/** A sanction is read by the host readers of the league and of the event's lobby. */
export function sanctionDecision(
  holder: Holder,
  resource: Of<'sanction'>,
): AuthorizationDecision {
  return under(
    hostAuthority(holder, organization(resource.league)) ??
      hostAuthority(holder, lobby(resource.scope)),
  );
}

/** A thing read through the audience rule, on a resource in a tournament. */
export function audienceRead(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'draw' | 'fixture' | 'ballot'>,
): AuthorizationDecision | null {
  const thing =
    resource.kind === 'draw' && capability === 'posting.read'
      ? 'posting'
      : resource.kind === 'fixture' && capability === 'result.read'
        ? 'decision'
        : resource.kind === 'ballot' && capability === 'ballot.read'
          ? resource.part
          : null;
  return thing === null
    ? null
    : audienceDecision(
        holder,
        resource.scope,
        thing,
        resource.viewing,
        conflictOf(resource),
      );
}
