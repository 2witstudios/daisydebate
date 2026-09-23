import type { PresenceStatus as Presence } from '@daisy/protocol';
import type { Tier } from '../types/tier/tier';

export type MockUser = {
  readonly name: string;
  readonly tier: Tier;
  readonly rating: number;
  readonly presence: Presence;
};

export const users: readonly MockUser[] = [
  { name: 'Alex Chen', tier: 'diamond', rating: 1820, presence: 'online' },
  { name: 'Maya Singh', tier: 'grandmaster', rating: 1810, presence: 'online' },
  { name: 'Daniel Kim', tier: 'elite', rating: 1762, presence: 'online' },
  { name: 'Sophia Lee', tier: 'master', rating: 1921, presence: 'in-debate' },
  { name: 'Marcus Bell', tier: 'master', rating: 1887, presence: 'in-debate' },
  { name: 'Priya Shah', tier: 'diamond', rating: 1804, presence: 'away' },
];
