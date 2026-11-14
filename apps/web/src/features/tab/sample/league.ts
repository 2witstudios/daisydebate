import { linkTo, sampleAction, type TabAction } from '../action';
import type { HostLeague, SeasonRow } from '../league';
import { hostRoutes, tabRoutes } from '../routes';
import {
  openSetting,
  type ResolvedSetting,
  type SettingScope,
} from '../settings';
import type { RailItem, RailStanding, TimelineRail } from '../tournament';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import { done, said } from './rail';
import type { SampleScene } from './scene';

const stop = (
  id: string,
  label: string,
  standing: RailStanding | null,
  action: TabAction | null,
): RailItem => ({ id, label, time: null, standing, action });

export function sampleLeagueRail(
  slug: string,
  scene: SampleScene,
): TimelineRail | null {
  if (slug !== LEAGUE) return null;
  return {
    title: LEAGUE_NAME,
    subtitle: '2026 to 27 season',
    heading: null,
    footHeading: null,
    items: [
      stop(
        'september-opener',
        'September Opener',
        done,
        sampleAction('September Opener'),
      ),
      stop(
        AUTUMN,
        'Autumn Open',
        reached(scene, 'finished') ? done : said('today'),
        linkTo('Autumn Open', hostRoutes.tournament(AUTUMN)),
      ),
      stop(
        'ridgeview-invitational',
        'Ridgeview Invitational',
        said('asks to count'),
        linkTo('Ridgeview Invitational', hostRoutes.league(LEAGUE)),
      ),
      stop(
        WINTER,
        'Winter Classic',
        said('12 Dec'),
        linkTo('Winter Classic', hostRoutes.tournament(WINTER)),
      ),
      stop(
        'championship',
        'Championship',
        said('March'),
        sampleAction('Championship'),
      ),
    ],
    foot: [
      stop(
        'league',
        'League',
        null,
        linkTo('League', hostRoutes.league(LEAGUE)),
      ),
      stop(
        'people',
        'People',
        null,
        linkTo('People', hostRoutes.leaguePeople(LEAGUE)),
      ),
    ],
  };
}

const setting = (
  keys: readonly string[],
  label: string,
  value: string,
  hold: 'default' | 'enforced',
  scope: SettingScope = 'template',
  edit: TabAction | null = null,
): ResolvedSetting => ({
  keys,
  label,
  value,
  source: {
    scope,
    name: scope === 'template' ? 'the Varsity debate template' : LEAGUE_NAME,
  },
  control: openSetting(edit, hold),
  attention: null,
});

export const seasonRow = (
  place: number,
  name: string,
  school: string,
  points: number,
  you = false,
): SeasonRow => ({ place, name, school, points, you });

export const topOfSeason: readonly SeasonRow[] = [
  seasonRow(1, 'Jensen', 'Hartwell', 18),
  seasonRow(2, 'Castillo', 'Ridgeview', 15),
  seasonRow(3, 'Amari', 'Lakeside', 14),
];

const seasonNote =
  "From 1 certified tournament. Autumn Open is added when it's certified.";

export function sampleHostLeague(
  slug: string,
  _scene: SampleScene,
): HostLeague | null {
  if (slug !== LEAGUE) return null;
  const change = sampleAction('Change');
  return {
    name: LEAGUE_NAME,
    lede: '14 schools · 212 members · 9 rooms open in the lobby right now',
    lobbyView: linkTo('View the lobby as a member', tabRoutes.league(LEAGUE)),
    requests: [
      {
        event: 'Ridgeview Invitational',
        facts: 'Varsity debate · 28 Nov · hosted by Ridgeview',
        meets:
          'Follows your Varsity debate template, so it already meets everything the template enforces.',
        decline: sampleAction('Decline'),
        sanction: sampleAction('Sanction it', true),
      },
    ],
    template: {
      name: 'Varsity debate template',
      settings: [
        setting(['format'], 'Format', 'One-on-one, limited prep', 'enforced'),
        setting(
          ['ballot.definition'],
          'Ballot',
          '20 to 30 in halves, no low-point wins',
          'enforced',
        ),
        setting(
          ['standings.tiebreaks'],
          'Tiebreaks',
          "Wins, speaker points, opponents' wins, rating",
          'enforced',
        ),
        setting(
          ['pairing.preset'],
          'Pairing',
          'By record, no rematch',
          'default',
        ),
        setting(
          ['recording.capture', 'audience.video'],
          'Recording',
          'Recorded · video for the people in each round',
          'enforced',
        ),
      ],
      edit: sampleAction('Edit template'),
      note: 'anyone can copy it; an event that follows it can be sanctioned',
    },
    season: {
      heading: 'Season standings · Varsity',
      rows: topOfSeason,
      note: seasonNote,
      rule: sampleAction('How points are counted'),
    },
    ladder: {
      detail:
        "Rates lobby rooms and tournaments run here. 148 members rated. Separate from Daisy's ladders.",
      open: linkTo('Open the ladder', tabRoutes.league(LEAGUE, 'ladder')),
    },
    lobby: [
      setting(
        ['audience.posting'],
        'Who can join',
        'Members of the 14 schools, and families the league has added',
        'default',
        'lobby',
        change,
      ),
      setting(
        ['room.own_format', 'resolution.rule', 'judging.members'],
        'Rooms members can open',
        "From the league's templates · resolution drawn from November's pool of 30 · members may judge each other",
        'default',
        'lobby',
        change,
      ),
      setting(
        ['ladder.counts'],
        'Lobby rooms count for',
        'The league ladder · not season standings',
        'default',
        'lobby',
        change,
      ),
    ],
  };
}
