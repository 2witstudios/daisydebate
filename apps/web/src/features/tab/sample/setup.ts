import { choice, linkTo, sampleAction, type TabAction } from '../action';
import { hostRoutes } from '../routes';
import type { ResolvedSetting, SettingScope } from '../settings';
import type { TournamentSetup } from '../setup';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY, varsitySwitch } from './moment';
import type { SampleScene } from './scene';
import { tiebreaks } from './standings';

const change = sampleAction('Change');

const setting = (
  keys: readonly string[],
  label: string,
  value: string,
  scope: SettingScope,
  edit: TabAction | null = change,
  attention: string | null = null,
): ResolvedSetting => {
  const enforced = scope === 'organization';
  return {
    keys,
    label,
    value,
    source: {
      scope,
      name: enforced
        ? LEAGUE_NAME
        : scope === 'event'
          ? 'Varsity debate'
          : 'Autumn Open',
    },
    hold: enforced ? 'enforced' : 'default',
    locked: enforced,
    attention,
    edit: enforced ? null : edit,
  };
};

export function sampleSetup(
  slug: string,
  scene: SampleScene,
): TournamentSetup | null {
  if (slug !== AUTUMN) return null;
  const before = !reached(scene, 'prelims');
  return {
    event: varsitySwitch,
    lede: `Varsity debate. Started from ${LEAGUE_NAME}'s template; rooms inherit all of this and can't change it.`,
    settings: [
      setting(
        ['format'],
        'Format',
        'One-on-one, limited prep · 7 segments · 26 minutes',
        'event',
      ),
      setting(
        ['stage.structure', 'stage.place', 'stage.timing'],
        'Rounds',
        '4 prelims, then top 8 · online · everyone at once',
        'lobby',
      ),
      setting(
        ['ballot.definition'],
        'Ballot',
        'One score per speaker, 20 to 30 in halves · no low-point wins · no ties · double loss allowed in prelims',
        'event',
        linkTo('Change', hostRoutes.ballot(AUTUMN, VARSITY)),
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
        'Seeded by rating, then by record · 3 rules, 3 preferences, 1 warning',
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
        ['audience.posting', 'audience.video'],
        'Who can see it',
        'Postings: anyone with the link · Results: public · Video: participants',
        'lobby',
      ),
      setting(
        ['recording.capture'],
        'Recording',
        'Recorded and released to participants',
        'event',
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
        hold: 'default',
        locked: false,
        attention: before
          ? 'sanction requested 2 days ago, not yet answered'
          : null,
        edit: before ? sampleAction('View request') : null,
      },
    ],
    pairing: {
      preset: choice('Pairing preset', [
        'Seeded by rating, then by record',
        'Random, then by record',
      ]),
      firstRound: choice('Round 1', [`Seeded by ${LEAGUE_NAME} rating`]),
      laterRounds: choice('Later rounds use results through', [
        'The round before',
        'Two rounds before (start sooner)',
      ]),
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
      save: sampleAction('Save pairing', true),
    },
  };
}
