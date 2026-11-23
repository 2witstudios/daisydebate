import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { tabReleasedFor } from '../src/features/tab/route-release';
import { createFlows } from './auth-mounted-flows';
import type { TestApp } from './fixtures';
import type { TournamentHttp } from './tab-tournament-transport.test-support';
import type { Bot } from './tab-tournament.test-support';
import { tabComposition } from '../src/features/tab/composition';
import { audienceComposition } from '../src/features/spectating/audience-composition';

export async function openTournamentHttp(app: TestApp, bots: readonly Bot[]) {
  const flows = createFlows(app);
  const cookies = new Map<string, string>();
  for (const bot of bots) {
    const cookie = await flows.signInAgain(tournamentBotEmail(bot));
    if (!cookie) throw new Error(`No sign-in session for ${bot.name}`);
    cookies.set(bot.userId, cookie);
  }

  const tab = app.routes(tabComposition);
  const audience = app.routes(audienceComposition);
  const released = tabReleasedFor(app.app);
  // The Next route modules bind these same handlers and the same release gate.
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    routes: {
      '/api/notifications/read': { POST: audience.notificationsRead },
      '/api/notifications/preferences': {
        POST: audience.notificationPreferences,
      },
      '/api/notifications/shell': { GET: audience.notificationShell },
      '/api/tab/organization-command': {
        POST: tab.organizationCommand(released),
      },
      '/api/tab/organization-people': { GET: tab.organizationPeople(released) },
      '/api/tab/lobby-command': { POST: tab.lobbyCommand(released) },
      '/api/tab/settings-command': { POST: tab.settingsCommand(released) },
      '/api/tab/entries-command': { POST: tab.entriesCommand(released) },
      '/api/tab/judges-command': { POST: tab.judgesCommand(released) },
      '/api/tab/draw-command': { POST: tab.drawCommand(released) },
      '/api/tab/fixture-command': { POST: tab.fixtureCommand(released) },
      '/api/tab/confirmation-command': {
        POST: tab.confirmationCommand(released),
      },
      '/api/tab/result-command': { POST: tab.resultCommand(released) },
      '/api/tab/sanction-command': { POST: tab.sanctionCommand(released) },
      '/api/tab/tournament-setup': { GET: tab.tournamentSetup(released) },
      '/api/tab/tournament-event-settings': {
        GET: tab.tournamentEventSettings(released),
      },
      '/api/tab/host-draw': { GET: tab.hostDrawOverview(released) },
      '/api/tab/host-round': { GET: tab.hostRound(released) },
      '/api/tab/host-standings': { GET: tab.hostStandings(released) },
      '/api/tab/host-results': { GET: tab.hostResults(released) },
      '/api/tab/host-roster': { GET: tab.hostRoster(released) },
    },
    fetch: () => new Response(null, { status: 404 }),
  });
  const request: TournamentHttp = (caller, path, body) => {
    const cookie = cookies.get(caller.userId);
    if (!cookie) throw new Error('No session registered for tournament bot');
    const headers = new Headers({
      cookie,
      origin: app.origin,
      [CLIENT_IP_HEADER]: app.newClient(),
    });
    if (body !== undefined) headers.set('content-type', 'application/json');
    return fetch(new URL(path, server.url), {
      headers,
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
    });
  };
  return { request, close: () => server.stop(true) };
}

export const tournamentBotEmail = (bot: Bot) =>
  `tab-${bot.userId}@example.test`;
