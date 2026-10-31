import type {
  clubChoices,
  experienceChoices,
  interestCategoryChoices,
  wantChoices,
} from '@daisy/protocol';
import { catalogFormats } from '@daisy/db/catalog-formats';

/** The words on each onboarding choice, keyed by its stored value. */
export const wantLabels: Record<(typeof wantChoices)[number], string> = {
  debate: 'Debate',
  coach: 'Coach',
  judge: 'Judge',
  watch: 'Watch',
};
export const clubLabels: Record<(typeof clubChoices)[number], string> = {
  joining: 'I have a club',
  starting: 'I’m starting a club',
  own: 'On my own',
};
export const experienceLabels: Record<
  (typeof experienceChoices)[number],
  string
> = {
  new: 'New to debate',
  class: 'Debated in class or a club',
  circuit: 'Competed on a circuit',
  veteran: 'Coached or judged for years',
};

/**
 * The leagues most debaters name, high school and collegiate, as one-tap
 * suggestions beside the open field. Affiliation outlives the formats
 * Daisy runs today, so this is a curated list — the governing bodies'
 * common abbreviations — unioned with the leagues the format catalog
 * carries, so a league Daisy adds a format for shows up on its own. The
 * field stays open either way.
 */
const knownLeagues = [
  // High school circuits and the homeschool leagues.
  'NSDA',
  'NCFL',
  'TFA',
  'CHSSA',
  'NCFCA',
  'Stoa',
  // Collegiate governing bodies.
  'APDA',
  'NPDA',
  'NDT',
  'CEDA',
  'ADA',
  'NFA',
  'AFA',
  'PKD',
  'IPDA',
  'BP',
] as const;

export const leagueSuggestions: readonly string[] = [
  ...new Set([
    ...knownLeagues,
    ...catalogFormats.flatMap((format) => format.leagues),
  ]),
];
export const topicLabels: Record<
  (typeof interestCategoryChoices)[number],
  string
> = {
  politics: 'Politics',
  economics: 'Economics',
  philosophy: 'Philosophy',
  ethics: 'Ethics',
  law: 'Law',
  'science-and-tech': 'Science and tech',
  environment: 'Environment',
  education: 'Education',
  health: 'Health',
  international: 'International',
  culture: 'Culture',
  sports: 'Sports',
};
