import type { Tier } from '../types/tier/tier';

export type Viewer = {
  readonly name: string;
  readonly tier: Tier;
  readonly rating: number;
};

export const viewer: Viewer = {
  name: 'Alex Chen',
  tier: 'diamond',
  rating: 1820,
};
