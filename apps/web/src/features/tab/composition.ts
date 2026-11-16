import {
  createHostRoundRoute,
  createHostDrawOverviewRoute,
} from './host-draw-route';
import { readHostRound } from './reads/host-round';
import { readHostDrawOverview } from './reads/host-draw-overview';
import { createDrawCommandRoute } from './draw-command-route';
import { readHostResults } from './reads/host-results';
import {
  createHostResultsRoute,
  type HostResultsRouteDependencies,
} from './host-results-route';
import { readHostBallots } from './reads/host-ballots';
import {
  createHostBallotsRoute,
  type HostBallotsRouteDependencies,
} from './host-ballots-route';
import { readHostNavigation } from './reads/host-navigation';
import {
  createHostNavigationRoute,
  type HostNavigationRouteDependencies,
} from './host-navigation-route';
import { fixtureCommand } from './operations/fixture-command';
import { eventResultCommand } from './operations/event-result-command';
import { releaseCommand } from './operations/release-command';
import { settlePendingCommand } from './operations/confirmation-command';
import { requestConflictWaiver } from './operations/conflict-waiver-request';
import { confirmationCommandEnvelopeSchema } from '@daisy/protocol/lobby/confirmation-command';
import { readHostStandings } from './reads/host-standings';
import {
  createHostStandingsRoute,
  type HostStandingsRouteDependencies,
} from './host-standings-route';
import { readEventBallot } from './reads/event-ballot';
import {
  createEventBallotRoute,
  type EventBallotRouteDependencies,
} from './event-ballot-route';
import { readTournamentEventSettings } from './reads/tournament-event-settings';
import { guardianCommand } from './operations/guardian';
import { readFamilyHistory } from './reads/family-history';
import {
  createFamilyHistoryRoute,
  type FamilyHistoryRouteDependencies,
} from './family-history-route';
import {
  createTournamentEventSettingsRoute,
  type TournamentEventSettingsRouteDependencies,
} from './tournament-event-settings-route';
import { readTournamentSetup } from './reads/tournament-setup';
import {
  createTournamentSetupRoute,
  type TournamentSetupRouteDependencies,
} from './tournament-setup-route';
import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import {
  createTabCommandRoute,
  type TabCommandRouteDependencies,
  type TabCommandOperation,
} from './command-route';
import { organizationCommand } from './operations/organization';
import {
  lobbyAdministrationCommand,
  isLobbyAdministration,
} from './operations/lobby-administration';
import { setupCommand } from './operations/setup';
import { settingCommand } from './operations/settings';
import { entryEnrollmentCommand } from './operations/entry-enrollment';
import { judgeRegistrationCommand } from './operations/judge-registration';
import { authorize } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import {
  createOrganizationPeopleRoute,
  type OrganizationPeopleRouteDependencies,
} from './organization-people-route';
import { readOrganizationPeople } from './reads/organization-people';

/**
 * Daisy Tab's routes, over the app's Tab store and the evaluator. Each takes
 * the release check from its Next route module: release flags never reach
 * the route table the proxy loads (ADR 0118).
 */
export function composeTabRoutes(app: App) {
  const store = app.database.tabCommands;
  const now = () => app.clock.now();
  const boundary = memberHttpBoundary(app);
  const read = readOrganizationPeople({ store, authorize, now });
  const common = { store, authorize, now, newId: createId };
  // A release flag cannot approve counsel's activation/notice or grant database privileges.
  const familyReleased = async () => false;
  const guardians = guardianCommand({
    ...common,
    minorsReleased: familyReleased,
    consentNoticeVersion: null,
  });
  const organization = organizationCommand(common);
  const administration = lobbyAdministrationCommand(common);
  const setup = setupCommand(common);
  const settings = settingCommand(common);
  const fixtures = fixtureCommand(common);
  const results = eventResultCommand(common);
  const releases = releaseCommand(common);
  const confirmations = settlePendingCommand(common);
  const waivers = requestConflictWaiver(common);
  const entries = entryEnrollmentCommand(common);
  // Counsel has not activated minors; cleanup exits are still decided by the operation.
  const judges = judgeRegistrationCommand({
    ...common,
    minorsReleased: async () => false,
  });
  const commandRoute = (
    released: TabCommandRouteDependencies['released'],
    operation: TabCommandOperation,
  ) => createTabCommandRoute({ ...operation, boundary, released });

  return {
    hostRound: (released: TabCommandRouteDependencies['released']) =>
      createHostRoundRoute({
        boundary,
        released,
        read: readHostRound({ store, authorize }),
      }),
    hostDrawOverview: (released: TabCommandRouteDependencies['released']) =>
      createHostDrawOverviewRoute({
        boundary,
        released,
        read: readHostDrawOverview({ store, authorize }),
      }),
    drawCommand: (released: TabCommandRouteDependencies['released']) =>
      createDrawCommandRoute({ ...common, boundary, released }),
    hostResults: (released: HostResultsRouteDependencies['released']) =>
      createHostResultsRoute({
        boundary,
        released,
        read: readHostResults({ store, authorize }),
      }),
    hostBallots: (released: HostBallotsRouteDependencies['released']) =>
      createHostBallotsRoute({
        boundary,
        released,
        read: readHostBallots({ store, authorize }),
      }),
    hostNavigation: (released: HostNavigationRouteDependencies['released']) =>
      createHostNavigationRoute({
        boundary,
        released,
        organizationIdOfHandle: store.organizationIdOfHandle,
        lobbyIdOfHandle: store.lobbyIdOfHandle,
        read: readHostNavigation({ store, authorize, now }),
      }),
    fixtureCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.fixture.command',
        address: 'lobby',
        execute: fixtures,
      }),
    resultCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.result.command',
        address: 'lobby',
        execute: results,
      }),
    releaseCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.release.command',
        address: 'lobby',
        execute: releases,
      }),
    confirmationCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.confirmation.command',
        address: 'lobby',
        execute: (principal, lobbyId, body) => {
          const parsed = confirmationCommandEnvelopeSchema.safeParse(body);
          if (!parsed.success) throw createAppError('VALIDATION');
          return parsed.data.command.type === 'request-conflict-waiver'
            ? waivers(principal, lobbyId, body)
            : confirmations(principal, lobbyId, body);
        },
      }),
    hostStandings: (released: HostStandingsRouteDependencies['released']) =>
      createHostStandingsRoute({
        boundary,
        released,
        read: readHostStandings({ store, authorize, now }),
      }),
    eventBallot: (released: EventBallotRouteDependencies['released']) =>
      createEventBallotRoute({
        boundary,
        released,
        read: readEventBallot({ store, authorize, now }),
      }),
    guardianCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.guardian.command',
        address: 'person',
        execute: guardians,
      }),
    familyHistory: (released: FamilyHistoryRouteDependencies['released']) =>
      createFamilyHistoryRoute({
        boundary,
        released,
        read: readFamilyHistory({
          store,
          authorize,
          now,
          minorsReleased: familyReleased,
        }),
      }),
    tournamentEventSettings: (
      released: TournamentEventSettingsRouteDependencies['released'],
    ) =>
      createTournamentEventSettingsRoute({
        boundary,
        released,
        read: readTournamentEventSettings({ store, authorize, now }),
      }),
    tournamentSetup: (released: TournamentSetupRouteDependencies['released']) =>
      createTournamentSetupRoute({
        boundary,
        released,
        lobbyIdOfHandle: store.lobbyIdOfHandle,
        read: readTournamentSetup({ store, authorize, now }),
      }),
    organizationCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.organization.command',
        address: 'none',
        execute: organization,
      }),
    lobbyCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.lobby.command',
        address: 'none',
        execute: (principal, body) => {
          const envelope = lobbySetupCommandEnvelopeSchema.safeParse(body);
          if (!envelope.success) throw createAppError('VALIDATION');
          return isLobbyAdministration(envelope.data.command)
            ? administration(principal, body)
            : setup(principal, body);
        },
      }),
    settingsCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.settings.command',
        address: 'none',
        execute: settings,
      }),
    entriesCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.entries.command',
        address: 'lobby',
        execute: entries,
      }),
    judgesCommand: (released: TabCommandRouteDependencies['released']) =>
      commandRoute(released, {
        name: 'tab.judges.command',
        address: 'lobby',
        execute: judges,
      }),
    organizationPeople: (
      released: OrganizationPeopleRouteDependencies['released'],
    ) =>
      createOrganizationPeopleRoute({
        boundary,
        released,
        organizationIdOfHandle: store.organizationIdOfHandle,
        read,
      }),
  };
}
