import type {
  GuardianView,
  WardAccountView,
  WardEntry,
  WardEntryRequestView,
} from '@daisy/protocol/lobby/guardian-read';
import { linkTo, sampleAction, type TabAction } from './action';
import { tabRoutes } from './routes';
import {
  samplePronouns,
  sampleGuardianView,
  sampleWardAccount,
  sampleWardEntryRequest,
} from './sample/guardian';
import type { SampleScene } from './sample/scene';

/** A lobby a guardian may allow a minor to see and join. */
type AllowedLobby = {
  readonly name: string;
  readonly detail: string | null;
  readonly allowed: boolean;
};

/** A minor's account as their guardian manages it. */
export type MinorAccount = {
  readonly back: { readonly label: string; readonly href: string };
  readonly name: string;
  readonly lede: string;
  readonly lobbiesLegend: string;
  readonly lobbies: readonly AllowedLobby[];
  readonly recordings: {
    readonly legend: string;
    readonly options: readonly string[];
    readonly chosen: number;
  };
  readonly boundary: string;
  readonly save: TabAction;
  readonly withdraw: TabAction;
};

/** An entry that waits because its tournament is outside the allowed lobbies. */
export type TournamentRequest = {
  readonly back: { readonly label: string; readonly href: string };
  readonly title: string;
  readonly lede: string;
  readonly facts: readonly {
    readonly title: string;
    readonly detail: string;
  }[];
  readonly consequence: { readonly allows: string; readonly keeps: string };
  readonly allow: TabAction;
  readonly decline: TabAction;
  readonly declineNote: string;
};

/** An entry of a minor's, as their guardian sees it from the family page. */
type FamilyEntry = {
  readonly tournament: string;
  readonly detail: string;
  /** Null while the entry waits for the guardian to allow its tournament. */
  readonly open: TabAction | null;
};

type FamilyMinor = {
  readonly name: string;
  readonly detail: string;
  readonly account: TabAction;
  readonly entries: readonly FamilyEntry[];
};

/** A guardian's family: what waits for them, then each minor and their entries. */
export type Family = {
  readonly waiting: readonly {
    readonly title: string;
    readonly detail: string;
    readonly review: TabAction;
  }[];
  readonly minors: readonly FamilyMinor[];
};

/**
 * The words a guardian's screens use for a ward. No stored datum gives a
 * person's pronouns, so the screen's caller supplies them.
 */
export type WardPronouns = {
  readonly subject: string;
  readonly object: string;
  readonly possessive: string;
};

const capitalized = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;
const dayMonth = (date: Date) =>
  `${date.getUTCDate()} ${months[date.getUTCMonth()] ?? ''}`;
/** "Sat 5 Dec". */
const dayLabel = (instant: string): string => {
  const date = new Date(instant);
  return `${weekdays[date.getUTCDay()] ?? ''} ${dayMonth(date)}`;
};
/** "2 Sept 2026". */
const dateLabel = (instant: string): string => {
  const date = new Date(instant);
  return `${dayMonth(date)} ${date.getUTCFullYear()}`;
};

const family = { label: 'Your family', href: tabRoutes.family };

const familyEntryOf = (entry: WardEntry): FamilyEntry => {
  const event =
    entry.partnerNames.length === 0
      ? entry.eventName
      : `${entry.eventName} with ${entry.partnerNames.join(' and ')}`;
  return {
    tournament: entry.lobby.name,
    detail:
      entry.timing.kind === 'upcoming'
        ? `${dayLabel(entry.timing.startsAt)} · ${event}`
        : `${event} · ${entry.timing.now}`,
    open: entry.awaitingGuardian
      ? null
      : linkTo('Open', tabRoutes.tournament(entry.lobby.handle)),
  };
};

/** A guardian's family page. */
function familyOf(
  view: GuardianView,
  pronouns: (wardId: string) => WardPronouns,
): Family {
  return {
    waiting: view.requests.map((request) => {
      const their = pronouns(request.ward.id).possessive;
      return {
        title: `Allow ${request.lobby.name} for ${request.ward.name}?`,
        detail: `Entered by ${their} ${request.enteredBy.relation}, ${request.enteredBy.name} · ${dayLabel(request.startsAt)} · ${their} entry waits for you`,
        review: linkTo(
          'Review',
          tabRoutes.allowTournament(request.ward.handle, request.lobby.handle),
          true,
        ),
      };
    }),
    minors: view.wards.map(
      ({ ward, linkStatus, allowedLobbyCount, entries, capabilities }) => ({
        name: ward.name,
        detail: `Age ${ward.age} · account ${linkStatus} · ${allowedLobbyCount} ${allowedLobbyCount === 1 ? 'lobby' : 'lobbies'} allowed`,
        account: capabilities.manageAccount
          ? linkTo('Account', tabRoutes.minor(ward.handle))
          : sampleAction('Account'),
        entries: entries.map(familyEntryOf),
      }),
    ),
  };
}

/** Who may watch a ward's recordings, in the order of the cap's values. */
const recordingOptions = (name: string, pronouns: WardPronouns) =>
  ({
    officials: `Only you, ${name} and ${pronouns.possessive} judges can watch`,
    lobby: 'Others in the room can watch too',
  }) as const;

/** The guardian's page for one ward's account and its restriction. */
function minorAccountOf(
  view: WardAccountView,
  pronouns: WardPronouns,
): MinorAccount {
  const { name } = view.ward;
  const options = recordingOptions(name, pronouns);
  const caps = ['officials', 'lobby'] as const;
  return {
    back: family,
    name: `${name}'s account`,
    lede: `Age ${view.ward.age} · you gave consent on ${dateLabel(view.consentedAt)}`,
    lobbiesLegend: `Lobbies ${name} can see and join`,
    lobbies: view.lobbies.map((lobby) => ({
      name: lobby.name,
      detail: lobby.description,
      allowed: lobby.allowed,
    })),
    recordings: {
      legend: `Recordings of ${name}`,
      options: caps.map((cap) => options[cap]),
      chosen: caps.indexOf(view.videoAudienceCap),
    },
    boundary: `${name} can see, join, watch and message only inside these lobbies, and in tournaments ${pronouns.subject} is entered in. That holds for search and for links people send ${pronouns.object}. ${capitalized(pronouns.possessive)} profile is never public. If a coach enters ${pronouns.object} somewhere outside these lobbies, it waits for you to allow it.`,
    save: sampleAction('Save', true),
    withdraw: sampleAction(`Withdraw consent and close ${name}'s account`),
  };
}

/** The guardian's decision on an entry outside the allowed lobbies. */
function tournamentRequestOf(
  view: WardEntryRequestView,
  pronouns: WardPronouns,
): TournamentRequest {
  const { tournament, ward, enteredBy } = view;
  const option = recordingOptions(ward.name, pronouns)[view.videoAudienceCap];
  return {
    back: family,
    title: `Allow ${tournament.name} for ${ward.name}?`,
    lede: `It is outside the lobbies you allow, so ${pronouns.possessive} entry waits for you.`,
    facts: [
      {
        title: tournament.name,
        detail: `${dayLabel(tournament.startsAt)} · ${tournament.place === 'online' ? 'online' : 'in person'} · run by ${tournament.organizerName}`,
      },
      {
        title: `Entered by ${enteredBy.name}`,
        detail: `${capitalized(pronouns.possessive)} ${enteredBy.relation} at ${enteredBy.organizationName}`,
      },
      { title: view.event.name, detail: view.event.summary },
      {
        title:
          tournament.recordedFor === 'officials'
            ? 'Recorded for officials'
            : 'Recorded for the lobby',
        detail: `Your choice still holds: ${option.charAt(0).toLowerCase()}${option.slice(1)}`,
      },
    ],
    consequence: {
      allows: `${ward.name} can see this tournament, join ${pronouns.possessive} rooms, watch its rounds and message people in it until it ends.`,
      keeps: `${tournament.organizerName}'s lobby and its other tournaments stay closed to ${pronouns.object}.`,
    },
    allow: sampleAction('Allow this tournament', true),
    decline: sampleAction('Decline'),
    declineNote: `Declining withdraws the entry and tells ${pronouns.possessive} ${enteredBy.relation}.`,
  };
}

export const readFamily = (scene: SampleScene): Family | null => {
  const view = sampleGuardianView(scene);
  return view === null ? null : familyOf(view, () => samplePronouns);
};

export const readMinorAccount = (
  minor: string,
  scene: SampleScene,
): MinorAccount | null => {
  const view = sampleWardAccount(minor, scene);
  return view === null ? null : minorAccountOf(view, samplePronouns);
};

export const readTournamentRequest = (
  minor: string,
  slug: string,
  scene: SampleScene,
): TournamentRequest | null => {
  const view = sampleWardEntryRequest(minor, slug, scene);
  return view === null ? null : tournamentRequestOf(view, samplePronouns);
};
