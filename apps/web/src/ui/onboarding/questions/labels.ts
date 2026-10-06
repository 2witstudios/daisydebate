import type {
  clubChoices,
  experienceChoices,
  formatChoices,
  lengthChoices,
  topicChoices,
  wantChoices,
} from '@daisy/protocol';

/** The words on each onboarding choice, keyed by its stored value. */
export const wantLabels: Record<(typeof wantChoices)[number], string> = {
  debate: 'Debate',
  coach: 'Coach',
  judge: 'Judge',
  watch: 'Watch',
};
export const clubLabels: Record<(typeof clubChoices)[number], string> = {
  joining: 'I have a club code',
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
export const formatLabels: Record<(typeof formatChoices)[number], string> = {
  'one-on-one': 'One-on-one',
  teams: 'Teams',
};
export const lengthLabels: Record<(typeof lengthChoices)[number], string> = {
  quick: 'Quick',
  full: 'Full length',
};
export const topicLabels: Record<(typeof topicChoices)[number], string> = {
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
