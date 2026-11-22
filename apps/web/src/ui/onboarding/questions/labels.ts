import type {
  clubChoices,
  experienceChoices,
  interestCategoryChoices,
  wantChoices,
} from '@daisy/protocol/onboarding';

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
 * Daisy runs today, so this is a curated list: the governing bodies'
 * common abbreviations. It holds every league the format catalog carries,
 * which labels.test.ts checks, because a client module cannot read the
 * catalog from the database package. The field stays open either way.
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

export const leagueSuggestions: readonly string[] = knownLeagues;
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
