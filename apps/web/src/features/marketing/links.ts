import type { PlanReleases } from '../pricing/plan-actions';

/**
 * The releases an audience page reads: each plan's own (as /pricing reads
 * them), whether /pricing is open, and whether a parent can add a child.
 */
export type AudienceReleases = PlanReleases & {
  readonly pricingPage: boolean;
  readonly parentalControls: boolean;
};

/**
 * Where an audience page may send its reader. A destination whose release
 * is closed is null, and the page leaves the link out: it never shows a
 * link that 404s and never says "coming soon".
 */
export type AudienceLinks = {
  readonly signIn: string;
  /** Whether Premium is sold: its sentences and price show only while it is. */
  readonly premiumOpen: boolean;
  /** Public and always open: where a reader writes to Daisy. */
  readonly support: string;
  readonly pricing: string | null;
  /** A parent adds or links a child here; the settings guard signs them in first. */
  readonly addChild: string | null;
  readonly startClub: string | null;
  readonly host: string | null;
  readonly league: string | null;
  readonly ncfca: string;
  readonly parents: string | null;
  readonly coach: string | null;
  readonly leagues: string | null;
  readonly tab: string | null;
};

const when = (open: boolean, href: string): string | null =>
  open ? href : null;

export const audienceLinks = (releases: AudienceReleases): AudienceLinks => ({
  signIn: '/sign-in',
  premiumOpen: releases.premiumCheckout,
  support: '/support',
  pricing: when(releases.pricingPage, '/pricing'),
  addChild: when(releases.parentalControls, '/settings/parental-controls'),
  startClub: when(releases.clubSeats, '/clubs/new'),
  host: when(releases.hostTiers, '/host'),
  league: when(releases.leagueRequests, '/contact/league'),
  // Each audience page exists while its own main action does.
  ncfca: '/ncfca',
  parents: when(releases.parentalControls, '/parents'),
  coach: when(releases.clubSeats, '/coach'),
  leagues: when(releases.leagueRequests, '/leagues'),
  tab: when(releases.hostTiers, '/tab'),
});
