import type { Tier } from '../types/tier/tier';

export type MockUser = {
  readonly name: string;
  readonly tier: Tier;
  readonly rating: number;
};

export const users: readonly MockUser[] = [
  { name: 'Alex Chen', tier: 'diamond', rating: 1820 },
  { name: 'Maya Singh', tier: 'grandmaster', rating: 1810 },
  { name: 'Daniel Kim', tier: 'elite', rating: 1762 },
  { name: 'Sophia Lee', tier: 'master', rating: 1921 },
  { name: 'Marcus Bell', tier: 'master', rating: 1887 },
  { name: 'Priya Shah', tier: 'diamond', rating: 1804 },
];
