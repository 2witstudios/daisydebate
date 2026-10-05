/**
 * The onboarding questionnaire's closed vocabularies: the web parser
 * accepts only these and the database CHECKs pin the same lists.
 */
export const wantChoices = ['debate', 'coach', 'judge', 'watch'] as const;
export const clubChoices = ['joining', 'starting', 'own'] as const;
export const experienceChoices = [
  'new',
  'class',
  'circuit',
  'veteran',
] as const;
export const formatChoices = ['one-on-one', 'teams'] as const;
export const lengthChoices = ['quick', 'full'] as const;
export const topicChoices = [
  'politics',
  'economics',
  'philosophy',
  'ethics',
  'law',
  'science-and-tech',
  'environment',
  'education',
  'health',
  'international',
  'culture',
  'sports',
] as const;

export type Want = (typeof wantChoices)[number];
export type Club = (typeof clubChoices)[number];
export type Experience = (typeof experienceChoices)[number];
export type Format = (typeof formatChoices)[number];
export type Length = (typeof lengthChoices)[number];
export type Topic = (typeof topicChoices)[number];
