import type {
  AttentionItem,
  OrganizedTournament,
} from '../../features/tournaments/organize-dashboard';
import type { Draft } from '../../features/tournaments/create-wizard';
import { tournamentRoutes } from '../../features/tournaments/routes';

/** The sample organizer's own tournaments. Draft has no public page yet. */
export const sampleOrganized: readonly OrganizedTournament[] = [
  {
    id: 'harvest-cup',
    name: 'Harvest Cup',
    phase: 'in-progress',
    summary: 'Single elimination, 8 entrants',
    note: 'Semifinals in progress. 1 result to check.',
    action: {
      label: 'Open console',
      href: tournamentRoutes.console('harvest-cup'),
    },
  },
  {
    id: 'autumn-open',
    name: 'Autumn Open',
    phase: 'registration',
    summary: 'Single elimination, 24 of 32',
    note: 'Closes Thu 8 Oct, 18:00. Bracket not made yet.',
    action: { label: 'Manage', href: tournamentRoutes.console('autumn-open') },
  },
  {
    id: 'winter-draft',
    name: 'Winter Open',
    phase: 'draft',
    summary: 'Single elimination, 16 places',
    note: 'Draft. Schedule and rules still to set.',
    action: { label: 'Continue setup', href: tournamentRoutes.create },
  },
  {
    id: 'summer-invitational',
    name: 'Summer Invitational',
    phase: 'completed',
    summary: 'Single elimination, 16 entrants',
    note: 'Results published Sun 30 Aug.',
    action: {
      label: 'View results',
      href: tournamentRoutes.results('summer-invitational'),
    },
  },
];

export const sampleAttention: readonly AttentionItem[] = [
  {
    title: 'Harvest Cup: ballot missing',
    detail: 'Semifinal 2 has no ballot 18 minutes after the judge dropped.',
    action: {
      label: 'Enter result',
      href: `${tournamentRoutes.console('harvest-cup')}?tab=results&round=running`,
    },
  },
  {
    title: 'Harvest Cup: conduct report',
    detail: 'One open report from the quarterfinals.',
    action: {
      label: 'Review report',
      href: `${tournamentRoutes.console('harvest-cup')}?tab=moderation`,
    },
  },
  {
    title: 'Autumn Open: judges needed',
    detail: '8 judges volunteered. Round 1 needs up to 8.',
    action: null,
  },
];

/** The sample draft the create wizard shows; fields are read-only for now. */
export const sampleDraft: Draft = {
  name: 'Winter Open',
  description:
    'A single-elimination tournament for debaters of every rating. (Sample organizer description, up to 600 characters.)',
  listed: true,
  seeding: 'By rating when registration closes',
  waitlist: true,
  registrationOpens: '2026-10-12T09:00',
  registrationCloses: '2026-11-05T18:00',
  timeZone: 'UTC',
  checkIn: '10 minutes',
  grace: '10 minutes',
  rules: 'standard',
  panel: '1 judge for every round',
};
