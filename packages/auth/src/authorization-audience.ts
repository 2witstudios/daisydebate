import type {
  ReleaseAudience,
  ReleaseThing,
} from '@daisy/protocol/release-audience';
import {
  allowRelated,
  allowUnder,
  deny,
  type AuthorizationDecision,
  type Conflict,
} from './authorization-decision';
import { conflictRefusal } from './authorization-conflict';
import { hostAreaAuthority, type Holder } from './authorization-holding';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import type {
  LobbyScopeFact,
  VideoSubjectsFact,
  ViewingFact,
} from './authorization-lobby-facts';

/**
 * The audiences a viewer belongs to. `link` and `public` hold for anyone
 * asking by id. Two fixed rules cap video whatever was released: a
 * guardian's `officials` cap leaves no audience, and video with a minor
 * seated is never the public's.
 */
function audiencesOf(
  viewing: ViewingFact,
  subjects: VideoSubjectsFact | null,
): readonly ReleaseAudience[] {
  if (subjects?.guardianCap === 'officials') return [];
  return [
    ...viewing.audiences,
    'link',
    ...(subjects?.minorSeated ? [] : (['public'] as const)),
  ];
}

/**
 * The one redaction rule: a thing is visible when a release of it exists
 * for an audience the viewer belongs to. Only releases are read, so a later
 * change of setting never closes what was opened. `subjects` is the people
 * on a video and null for every other thing.
 */
export function visibleThing(
  thing: ReleaseThing,
  viewing: ViewingFact,
  subjects: VideoSubjectsFact | null,
): boolean {
  const audiences = audiencesOf(viewing, subjects);
  return viewing.releases.some(
    (release) =>
      release.thing === thing && audiences.includes(release.audience),
  );
}

/**
 * Unreleased access belongs to the thing's own host area. Ballot permission
 * never becomes video, draw or aggregate-results authority. A conflict stops
 * that authority; recorded audience releases remain independent.
 */
export function audienceDecision(
  holder: Holder,
  scope: LobbyScopeFact,
  thing: ReleaseThing,
  viewing: ViewingFact,
  conflict: Conflict | null,
  subjects: VideoSubjectsFact | null = null,
  decisionArea: 'ballots' | 'results' = 'ballots',
): AuthorizationDecision {
  const area =
    thing === 'video'
      ? 'lobby.host.recordings.read'
      : thing === 'posting'
        ? 'lobby.host.draw.read'
        : decisionArea === 'results'
          ? 'lobby.host.results.read'
          : 'lobby.host.ballots.read';
  const official = hostAreaAuthority(
    holder,
    { kind: 'lobby', scope },
    capabilityMetadata[area].hostAreaPermissions ?? [],
  );
  if (official && conflictRefusal(conflict) === null)
    return allowUnder(official);
  return visibleThing(thing, viewing, subjects)
    ? allowRelated('audience')
    : deny('missing-capability');
}
