import type { ReactElement } from 'react';
import { initialFormState } from '../../features/forms/form-state';
import {
  readBallotSettings,
  readJudgeBallot,
} from '../../features/tab/ballot-definition';
import { readDrawBoard } from '../../features/tab/draw';
import {
  readHostEntries,
  readHostJudges,
  readSchoolEntries,
} from '../../features/tab/entries';
import { readEventsSchedule } from '../../features/tab/events';
import {
  readFamily,
  readMinorAccount,
  readTournamentRequest,
} from '../../features/tab/guardian';
import {
  readCreateRoom,
  leagueViewOf,
  readHostLeague,
  readLeagueLobby,
  readLeagueRail,
} from '../../features/tab/league';
import {
  readHostHome,
  readHostRail,
  readPeople,
} from '../../features/tab/organization';
import { readResolutionPool } from '../../features/tab/resolution-pool';
import { readEventResults } from '../../features/tab/results';
import { readLiveSection, readRoom } from '../../features/tab/room';
import { hostRoutes, participantPathOf } from '../../features/tab/routes';
import { holdsGrant, type SampleScene } from '../../features/tab/sample/scene';
import { readSetup } from '../../features/tab/setup';
import { readStandings } from '../../features/tab/standings';
import { readRunningRound, readTimeSlot } from '../../features/tab/tab-round';
import {
  landingStop,
  readTimelineRail,
  readTournamentPage,
  readTournamentsIndex,
  type TournamentView,
} from '../../features/tab/tournament';
import { readWalk } from '../../features/tab/walk';
import { BallotSettings } from './ballot-settings/ballot-settings';
import { DrawBoard } from './draw-board/draw-board';
import { EventsSchedule } from './events-schedule/events-schedule';
import { Family } from './guardian/family';
import { MinorAccount } from './guardian/minor-account';
import { TournamentRequest } from './guardian/tournament-request';
import { HostEntries } from './host-entries/host-entries';
import { HostJudges } from './host-entries/host-judges';
import { HostHome } from './host-home/host-home';
import { HostLeague } from './host-league/host-league';
import { JudgeBallot } from './judge-ballot/judge-ballot';
import { CreateRoom } from './league-lobby/create-room';
import { LeagueLobby } from './league-lobby/league-lobby';
import { LiveSection } from './live-section/live-section';
import { People } from './people/people';
import { Resolutions } from './resolutions/resolutions';
import { Results } from './results/results';
import { RunningRound } from './running-round/running-round';
import type { SampleSubmit } from './sample-form/sample-form';
import { SchoolEntries } from './school-entries/school-entries';
import { Setup } from './setup/setup';
import { HostStandings } from './standings/host-standings';
import { TimeSlot } from './time-slot/time-slot';
import { TournamentPage } from './tournament-page/tournament-page';
import { TournamentsDirectory } from './tournaments-directory/tournaments-directory';
import { WaitingRoom } from './waiting-room/waiting-room';
import { Walk } from './walk/walk';

/** What a Tab address answers with: a screen, a move elsewhere, or nothing. */
export type SampleAnswer =
  | { readonly kind: 'screen'; readonly element: ReactElement }
  | { readonly kind: 'moved'; readonly to: string }
  | { readonly kind: 'missing' };

const submit: SampleSubmit = () => async () => initialFormState;
const missing: SampleAnswer = { kind: 'missing' };
const screen = (element: ReactElement | null): SampleAnswer =>
  element === null ? missing : { kind: 'screen', element };

function tournamentScreen(
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): SampleAnswer {
  const page = readTournamentPage(slug, view, scene);
  return screen(page && <TournamentPage page={page} />);
}

function participant(
  segments: readonly string[],
  query: URLSearchParams,
  scene: SampleScene,
): SampleAnswer {
  const [area, id, ...rest] = segments;
  const event = query.get('event');
  if (area === 'tournaments' && id === undefined)
    return screen(<TournamentsDirectory index={readTournamentsIndex(scene)} />);
  if (area === 'tournaments' && id === 'walk' && rest.length === 0)
    return screen(<Walk walk={readWalk(scene)} choose={submit('Choose')} />);
  if (area === 'tournaments' && id !== undefined) {
    if (rest.length === 0) return tournamentScreen(id, { kind: 'home' }, scene);
    if (rest.join('/') === 'standings')
      return tournamentScreen(id, { kind: 'standings', event }, scene);
    if (rest.join('/') === 'bracket')
      return tournamentScreen(id, { kind: 'bracket', event }, scene);
    if (rest.join('/') === 'entries') {
      const entries = readSchoolEntries(id, scene);
      return screen(
        entries && <SchoolEntries entries={entries} submit={submit} />,
      );
    }
    const [events, eventSlug, rounds, round, ...more] = rest;
    if (
      events === 'events' &&
      rounds === 'rounds' &&
      eventSlug !== undefined &&
      round !== undefined &&
      more.length === 0
    )
      return tournamentScreen(
        id,
        { kind: 'round', event: eventSlug, round },
        scene,
      );
    return missing;
  }
  if (area === 'leagues' && id !== undefined) {
    if (rest.length === 0) {
      const lobby = readLeagueLobby(
        id,
        leagueViewOf({
          tab: query.get('tab'),
          scope: query.get('scope'),
          search: query.get('q'),
          event: query.get('event'),
        }),
        scene,
      );
      return screen(lobby && <LeagueLobby lobby={lobby} />);
    }
    if (rest.join('/') === 'rooms/new') {
      const room = readCreateRoom(id, scene);
      return screen(room && <CreateRoom room={room} submit={submit} />);
    }
    return missing;
  }
  if (area === 'rooms' && id === 'sample') {
    const [room, page, ...more] = rest;
    if (room === undefined || more.length > 0) return missing;
    if (page === undefined) {
      const read = readRoom(room, scene);
      return screen(read && <WaitingRoom room={read} />);
    }
    if (page === 'live') {
      const section = readLiveSection(room, scene);
      return screen(section && <LiveSection section={section} />);
    }
    if (page === 'ballot') {
      const ballot = readJudgeBallot(room, scene);
      return screen(ballot && <JudgeBallot ballot={ballot} submit={submit} />);
    }
    return missing;
  }
  if (area === 'family' && id === undefined) {
    const family = readFamily(scene);
    return screen(family && <Family family={family} />);
  }
  if (area === 'family' && id !== undefined) {
    if (rest.length === 0) {
      const account = readMinorAccount(id, scene);
      return screen(
        account && <MinorAccount account={account} submit={submit} />,
      );
    }
    const [allow, slug, ...more] = rest;
    if (allow === 'allow' && slug !== undefined && more.length === 0) {
      const request = readTournamentRequest(id, slug, scene);
      return screen(request && <TournamentRequest request={request} />);
    }
  }
  return missing;
}

function hostTournament(
  slug: string,
  rest: readonly string[],
  query: URLSearchParams,
  scene: SampleScene,
): SampleAnswer {
  const rail = readTimelineRail(slug, scene);
  if (rail === null) return missing;
  const page = rest.join('/');
  const setup = readSetup(slug, scene);
  if (page === '') {
    const stop = landingStop(rail);
    return stop === null ? missing : { kind: 'moved', to: stop };
  }
  if (page === 'setup')
    return screen(
      setup && (
        <Setup
          rail={rail}
          setup={setup}
          panel={query.get('panel') === 'pairing' ? 'pairing' : null}
          submit={submit}
        />
      ),
    );
  if (page === 'events') {
    const schedule = readEventsSchedule(slug, query.get('event'), scene);
    return screen(
      schedule && (
        <EventsSchedule rail={rail} schedule={schedule} submit={submit} />
      ),
    );
  }
  const hrefs = {
    entriesHref: hostRoutes.entries(slug),
    judgesHref: hostRoutes.judges(slug),
  };
  if (page === 'entries') {
    const entries = readHostEntries(slug, scene);
    return screen(
      entries && <HostEntries rail={rail} entries={entries} {...hrefs} />,
    );
  }
  if (page === 'judges') {
    const judges = readHostJudges(slug, scene);
    return screen(
      judges && <HostJudges rail={rail} judges={judges} {...hrefs} />,
    );
  }
  if (page === 'people')
    return screen(
      <People
        rail={rail}
        people={readPeople(query.get('role'), hostRoutes.people(slug), scene)}
      />,
    );
  if (page === 'standings') {
    const table = readStandings(slug, null, scene);
    return screen(
      table && setup && (
        <HostStandings rail={rail} event={setup.event} table={table} />
      ),
    );
  }
  if (page === 'results') {
    const results = readEventResults(slug, scene);
    return screen(
      results && setup && (
        <Results rail={rail} event={setup.event} results={results} />
      ),
    );
  }
  const [kind, id, sub, round, ...more] = rest;
  if (kind === 'slots' && id !== undefined && sub === undefined) {
    const slot = readTimeSlot(slug, id, query.get('event'), scene);
    return screen(
      slot && <TimeSlot rail={rail} current={`slot-${id}`} slot={slot} />,
    );
  }
  if (kind !== 'events' || id === undefined || more.length > 0) return missing;
  if (sub === 'ballot' && round === undefined) {
    const settings = readBallotSettings(slug, id, scene);
    return screen(
      settings && (
        <BallotSettings rail={rail} settings={settings} submit={submit} />
      ),
    );
  }
  if (sub === 'resolutions' && round === undefined) {
    const pool = readResolutionPool(slug, id, scene);
    return screen(pool && <Resolutions rail={rail} pool={pool} />);
  }
  if (sub !== 'rounds' || round === undefined) return missing;
  const current = `round-${round}`;
  const draw = readDrawBoard(slug, id, round, query.get('fixture'), scene);
  if (draw !== null)
    return screen(<DrawBoard rail={rail} current={current} draw={draw} />);
  const running = readRunningRound(slug, id, round, scene);
  return screen(
    running && <RunningRound rail={rail} current={current} round={running} />,
  );
}

function host(
  segments: readonly string[],
  query: URLSearchParams,
  scene: SampleScene,
): SampleAnswer {
  const [area, slug, ...rest] = segments;
  if (area === undefined)
    return screen(
      <HostHome rail={readHostRail(scene)} home={readHostHome(scene)} />,
    );
  if (slug === undefined) return missing;
  if (area === 'tournaments') return hostTournament(slug, rest, query, scene);
  if (area !== 'leagues') return missing;
  const rail = readLeagueRail(slug, scene);
  if (rail === null) return missing;
  if (rest.length === 0) {
    const league = readHostLeague(slug, scene);
    return screen(league && <HostLeague rail={rail} league={league} />);
  }
  if (rest.join('/') === 'people')
    return screen(
      <People
        rail={rail}
        people={readPeople(
          query.get('role'),
          hostRoutes.leaguePeople(slug),
          scene,
        )}
      />,
    );
  return missing;
}

/**
 * Test support: what the Tab route at `href` answers for a sample viewer,
 * composed as its page composes it. The pages themselves need a request, so
 * the walk test reads the same reads through this table.
 */
export function sampleAnswer(href: string, scene: SampleScene): SampleAnswer {
  const [path = '', search = ''] = href.split('?');
  const segments = path.split('/').filter(Boolean);
  const query = new URLSearchParams(search);
  if (segments[0] !== 'host') return participant(segments, query, scene);
  if (!holdsGrant(scene)) return { kind: 'moved', to: participantPathOf(path) };
  return host(segments.slice(1), query, scene);
}
