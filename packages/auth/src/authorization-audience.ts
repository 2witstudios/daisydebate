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
import { holds, type Holder } from './authorization-holding';
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
 * An official holds `tournament.ballots.read_unreleased` on the lobby and
 * sees everything, unless a conflict stops that authority; then, like
 * everyone else, they see what their audiences were released.
 */
export function audienceDecision(
  holder: Holder,
  scope: LobbyScopeFact,
  thing: ReleaseThing,
  viewing: ViewingFact,
  conflict: Conflict | null,
  subjects: VideoSubjectsFact | null = null,
): AuthorizationDecision {
  const official = holds(holder, 'tournament.ballots.read_unreleased', {
    kind: 'lobby',
    scope,
  });
  if (official.held && conflictRefusal(conflict) === null)
    return allowUnder(official.authority);
  return visibleThing(thing, viewing, subjects)
    ? allowRelated('audience')
    : deny('missing-capability');
}
