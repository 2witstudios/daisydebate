import { choice, sampleAction } from '../action';
import type { CreateRoom } from '../league';
import { tabRoutes } from '../routes';
import { lockedSetting, type ResolvedSetting } from '../settings';
import { isMember } from './league-lobby';
import { LEAGUE, LEAGUE_NAME } from './moment';
import type { SampleScene } from './scene';

export function sampleCreateRoom(
  slug: string,
  scene: SampleScene,
): CreateRoom | null {
  if (slug !== LEAGUE || !isMember(scene)) return null;
  const enforced = (
    keys: readonly string[],
    label: string,
    value: string,
  ): ResolvedSetting => ({
    keys,
    label,
    value,
    source: { scope: 'organization', name: LEAGUE_NAME },
    control: lockedSetting,
    attention: null,
  });
  return {
    lobby: { name: LEAGUE_NAME, href: tabRoutes.league(LEAGUE) },
    name: 'Practice before Winter Classic',
    templates: [
      { name: 'Varsity', detail: 'One-on-one' },
      { name: 'Novice', detail: 'One-on-one' },
      { name: 'Parli', detail: 'Two-on-two' },
    ],
    template: 'Varsity',
    lockedBy: LEAGUE_NAME,
    locked: [
      enforced(
        ['format'],
        'Format',
        'One-on-one, limited prep · 7 segments · 26 minutes',
      ),
      enforced(
        ['ballot.definition'],
        'Ballot',
        '20 to 30 in halves · no low-point wins',
      ),
      enforced(
        ['resolution.rule'],
        'Resolution',
        "You strike from five drawn from November's pool",
      ),
      enforced(
        ['recording.capture', 'audience.video'],
        'Recording',
        'Recorded · video for the people in each round',
      ),
    ],
    defaults: [
      choice('Who can join', ['League members', 'People I invite']),
      choice('Judge', ['A league member', 'No judge']),
    ],
    ranked: {
      label: 'Ranked',
      detail: `${LEAGUE_NAME} ladder`,
      checked: true,
    },
    open: sampleAction('Create room', true),
  };
}
