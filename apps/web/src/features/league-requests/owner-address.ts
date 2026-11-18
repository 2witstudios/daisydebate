/**
 * Where League requests are emailed (point guard, 2026-11-18): their own
 * address when one is set, otherwise the owner address beta access already
 * uses, so requests reach the owner without a new secret. Neither set, no
 * address: requests are stored and their email waits.
 */
export const leagueRequestOwnerAddress = (config: {
  readonly LEAGUE_REQUEST_NOTIFY_EMAIL?: string | undefined;
  readonly BETA_NOTIFY_EMAIL?: string | undefined;
}): string | undefined =>
  config.LEAGUE_REQUEST_NOTIFY_EMAIL ?? config.BETA_NOTIFY_EMAIL;
