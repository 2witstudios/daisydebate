import { choice, linkTo, sampleAction, type TabAction } from '../action';
import { hostRoutes } from '../routes';
import {
  lockedSetting,
  lockedWithView,
  openSetting,
  type ResolvedSetting,
  type SettingScope,
} from '../settings';
import type { TournamentSetup } from '../setup';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import { varsitySwitch } from './event-switch';
import type { SampleScene } from './scene';
import { tiebreaks } from './standings';

const change = sampleAction('Change');

const setting = (
  keys: readonly string[],
  label: string,
  value: string,
  scope: Exclude<SettingScope, 'organization'>,
  edit: TabAction | null = change,
  attention: string | null = null,
): ResolvedSetting => ({
  keys,
  label,
  value,
  source: {
    scope,
    name: scope === 'event' ? 'Varsity debate' : 'Autumn Open',
  },
  control: openSetting(edit),
  attention,
});

/** A setting the league's template enforces: the tournament cannot change it. */
const enforced = (
  keys: readonly string[],
  label: string,
  value: string,
  view: TabAction | null = null,
): ResolvedSetting => ({
  keys,
  label,
  value,
  source: { scope: 'organization', name: LEAGUE_NAME },
  control: view === null ? lockedSetting : lockedWithView(view),
  attention: null,
});

export function sampleSetup(
  slug: string,
  scene: SampleScene,
): TournamentSetup | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    event: varsitySwitch(scene),
    lede: `Varsity debate. Follows ${LEAGUE_NAME}'s template; rooms inherit all of this and can't change it.`,
    settings: [
      enforced(
        ['format'],
        'Format',
        'One-on-one, limited prep · 7 segments · 26 minutes',
      ),
      setting(
        ['stage.structure', 'stage.place', 'stage.timing'],
        'Rounds',
        '4 prelims, then top 8 · online · everyone at once',
        'lobby',
      ),
      enforced(
        ['ballot.definition'],
        'Ballot',
        'One score per speaker, 20 to 30 in halves · no low-point wins · no ties · double loss allowed in prelims',
        // The template pins the whole ballot, so its page is there to read.
        linkTo('View', hostRoutes.ballot(AUTUMN, VARSITY)),
      ),
      setting(
        ['judging.panel', 'judging.ai'],
        'Judges',
        '1 per room in prelims · 3 in elims · 5 in the final · AI judge off',
        'lobby',
      ),
      setting(
        ['resolution.rule'],
        'Resolutions',
        'Each room strikes from 5 drawn from your pool',
        'lobby',
        linkTo(
          before ? 'Add resolutions' : 'Change',
          hostRoutes.resolutions(AUTUMN, VARSITY),
        ),
        before ? 'the pool has 18, needs 20' : null,
      ),
      setting(
        ['pairing.preset'],
        'Pairing',
        'Power-matched preset · 3 rules, 3 preferences, 1 warning',
        'event',
        linkTo('Open', hostRoutes.setup(AUTUMN, 'pairing')),
      ),
      tiebreaks,
      setting(
        [
          'audience.decision',
          'audience.scores',
          'audience.reason',
          'audience.feedback',
        ],
        'Ballot release',
        'Coaches and parents each round · competitors after prelims · public at the break',
        'daisy',
      ),
      setting(
        ['audience.posting'],
        'Who can see it',
        'Postings: anyone with the link · Results: public',
        'lobby',
      ),
      enforced(
        ['recording.capture', 'audience.video'],
        'Recording',
        'Recorded · video for the people in each round',
      ),
      setting(
        ['conflict.handling'],
        'Staff with a connection to a room',
        'A second person confirms',
        'lobby',
      ),
      {
        keys: ['sanction'],
        label: 'Counts for',
        value: LEAGUE_NAME,
        source: { scope: 'lobby', name: 'Autumn Open' },
        control: openSetting(before ? sampleAction('View request') : null),
        attention: before
          ? 'sanction requested 2 days ago, not yet answered'
          : null,
      },
    ],
    pairing: {
      preset: choice('Pairing preset', [
        'Power-matched',
        'Random',
        'Round robin',
      ]),
      summary: `Round 1 is seeded by ${LEAGUE_NAME} rating. Later rounds pair by record through the round before.`,
      policies: [
        {
          key: 'pairing.no_rematch',
          label: 'No rematch',
          force: 'rule',
          rank: null,
        },
        {
          key: 'pairing.one_bye',
          label: 'One bye per entry',
          force: 'rule',
          rank: null,
        },
        {
          key: 'judging.not_own_school',
          label: 'Judge not from either school',
          force: 'rule',
          rank: null,
        },
        {
          key: 'pairing.same_record',
          label: 'Same record',
          force: 'preference',
          rank: 1,
        },
        {
          key: 'pairing.avoid_same_school',
          label: 'Avoid same school',
          force: 'preference',
          rank: 2,
        },
        {
          key: 'pairing.balance_sides',
          label: 'Balance sides',
          force: 'preference',
          rank: 3,
        },
        {
          key: 'judging.seen_before',
          label: 'Judge seen this entry before',
          force: 'warning',
          rank: null,
        },
      ],
      forceNote: `A host picks a preset. ${LEAGUE_NAME} can set each of these individually in its template.`,
      save: sampleAction('Save pairing', true),
    },
  };
}
