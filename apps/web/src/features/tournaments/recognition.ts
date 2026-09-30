import type { Structure } from './tournament';

export type Recognition = {
  readonly title: string;
  readonly text: string;
};

/**
 * What an event recognizes. Honours are recognition only: they never change
 * a rating, and tournament debates are unrated.
 */
export const recognitionFor = (structure: Structure): readonly Recognition[] =>
  structure === 'single-elimination'
    ? [
        { title: 'Champion', text: 'honour on the profile and a certificate' },
        { title: 'Runner-up', text: 'honour and a certificate' },
        { title: 'Semifinalists', text: 'honour and a certificate' },
        {
          title: 'Every entrant',
          text: 'a participation record on the profile',
        },
      ]
    : [
        { title: 'Winner', text: 'honour on the profile and a certificate' },
        {
          title: 'Every entrant',
          text: 'a participation record on the profile',
        },
      ];
