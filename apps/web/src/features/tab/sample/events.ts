import type { TournamentSetupView } from '@daisy/protocol/lobby/lobby-setup-read';
import { choice, sampleAction } from '../action';
import type { EventFormCopy, EventsCopy } from '../events';
import { AUTUMN, LEAGUE_NAME, WINTER } from './moment';
import { sampleId, sampleIds } from './organization';
import type { SampleScene } from './scene';
import { sampleAutumnSetup, sampleEvent, slot } from './setup';

const league = { organizationId: sampleIds.league, name: LEAGUE_NAME };
const template = {
  templateId: sampleIds.varsityTemplate,
  name: 'Varsity debate',
  organization: league,
};

const novice = {
  value: 'First or second season',
  source: "the league's definition",
} as const;
const breaks = {
  openBreak: choice('Open break', ['Top 8', 'Top 4', 'Top 16']),
  noviceBreak: choice('Novice break', ['Top 4', 'Top 2', 'Top 8']),
  doubleQualifier: choice('A novice who makes both breaks', [
    'Goes to the open break; the next novice moves up',
    'Debates in both',
    'Chooses',
  ]),
} as const;

const parliForm: EventFormCopy = {
  divisions: choice(
    'Divisions',
    [
      'One pool, novices break separately',
      'Everyone together',
      'Separate events, each with its own draw',
    ],
    'Everyone is drawn together in prelims. Novices also get their own break and awards.',
  ),
  novice,
  prelimRounds: choice('Prelim rounds', ['3', '4', '5']),
  ...breaks,
  runsWith: choice('Runs with', ['Debate', 'Speech A', 'Speech B', 'A new group']),
  settings: sampleAction('Parli settings'),
  remove: sampleAction('Remove event'),
};

const varsityForm: EventFormCopy = {
  divisions: choice('Divisions', [
    'Everyone together',
    'One pool, novices break separately',
    'Separate events, each with its own draw',
  ]),
  novice,
  prelimRounds: choice('Prelim rounds', ['4', '3', '5']),
  ...breaks,
  runsWith: choice('Runs with', ['Debate', 'Speech', 'A new group']),
  settings: sampleAction('Varsity debate settings'),
  remove: sampleAction('Remove event'),
};

const shared = {
  actions: [sampleAction('Edit times'), sampleAction('Add event', true)],
  judgePool: {
    rule: 'A judge is cleared per event and is never in two rooms in the same slot.',
    action: sampleAction('Who is cleared for what'),
  },
} as const;

const winterDay = '2026-12-12';
const winterSlot = (key: string, name: string, time: string) =>
  slot(`winter${key}`, name, time, winterDay);
const debate = ['09:00', '12:00', '15:00'].map((time) =>
  winterSlot(time.replace(':', ''), 'Debate', time),
);
const debateBreaks = winterSlot('breaks', 'breaks', '18:00');
const speechA = winterSlot('a1030', 'Speech A', '10:30');
const finalA = winterSlot('afinal', 'final', '16:30');
const speechB = winterSlot('b1330', 'Speech B', '13:30');
const finalB = winterSlot('bfinal', 'final', '16:30');
const ids = (slots: readonly { readonly timeSlotId: string }[]) =>
  slots.map((one) => one.timeSlotId);

const winterDebate = (key: string, name: string, formatName: string, rounds: number) =>
  sampleEvent(`w${key}`, name, {
    formatName,
    prelims: ids(debate),
    elimination: [debateBreaks.timeSlotId, rounds],
    template,
  });
const winterSpeech = (key: string, name: string, prelim: string, final: string) =>
  sampleEvent(`w${key}`, name, {
    formatName: 'Sections of six, ranked',
    prelims: [prelim],
    elimination: [final, 1],
  });

/** Winter Classic's setup: eight events in three groups of shared slots. */
const winterSetup: TournamentSetupView = {
  kind: 'tournament',
  lobbyId: sampleIds.winter,
  handle: WINTER,
  name: 'Winter Classic',
  owner: league,
  status: 'draft',
  events: [
    winterDebate('varsityld', 'Varsity LD', 'League one-on-one', 3),
    winterDebate('noviceld', 'Novice LD', 'League one-on-one', 2),
    winterDebate('varsitypf', 'Varsity PF', 'League teams', 3),
    winterDebate('parli', 'Parli', 'League parli', 3),
    winterSpeech('impromptu', 'Impromptu', speechA.timeSlotId, finalA.timeSlotId),
    winterSpeech('oratory', 'Oratory', speechA.timeSlotId, finalA.timeSlotId),
    winterSpeech('extemp', 'Extemp', speechB.timeSlotId, finalB.timeSlotId),
    winterSpeech('interp', 'Interp', speechB.timeSlotId, finalB.timeSlotId),
  ],
  timeSlots: [...debate, debateBreaks, speechA, finalA, speechB, finalB],
  resolutionPools: [],
  capabilities: { manage: true },
};

const sections = 'Sections of six, ranked · anyone · top six to the final';
const winterCopy: EventsCopy = {
  ...shared,
  summaries: {
    [sampleId('wvarsityld')]:
      'League one-on-one format · anyone · breaks to quarterfinals · counts for the season',
    [sampleId('wnoviceld')]:
      'League one-on-one format · first or second season · breaks to semifinals · counts for the season',
    [sampleId('wvarsitypf')]:
      'League teams format · anyone · breaks to quarterfinals · counts for the season',
    [sampleId('wparli')]:
      'League parli format · one pool, novices break separately · counts for the season',
    [sampleId('wimpromptu')]: sections,
    [sampleId('woratory')]: sections,
    [sampleId('wextemp')]:
      'Sections of six, ranked · topic drawn 30 minutes before · top six to the final',
    [sampleId('winterp')]: sections,
  },
  forms: { [sampleId('wparli')]: parliForm },
  opening: 'parli',
  entryLimit: 'one debate event, one Speech A event and one Speech B event',
};

const autumnCopy: EventsCopy = {
  ...shared,
  summaries: {
    [sampleId('varsitydebate')]:
      'League one-on-one format · anyone · breaks to quarterfinals · counts for the season',
    [sampleId('noviceautumn')]:
      'League one-on-one format · first or second season · breaks to semifinals',
    [sampleId('impromptuautumn')]: sections,
  },
  forms: { [sampleId('varsitydebate')]: varsityForm },
  opening: 'varsity-debate',
  entryLimit: 'one debate event and one speech event',
};

/** The setup read the events screen is drawn from, and its words. */
export function sampleEventsSchedule(
  slug: string,
  scene: SampleScene,
): {
  readonly setup: TournamentSetupView;
  readonly copy: EventsCopy;
} | null {
  if (slug === WINTER) return { setup: winterSetup, copy: winterCopy };
  if (slug === AUTUMN) return { setup: sampleAutumnSetup(scene), copy: autumnCopy };
  return null;
}
