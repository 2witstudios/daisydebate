import { sampleAction, type TabAction } from '../action';
import type { PostingRow, TournamentPanel } from '../tournament';

export const watch = sampleAction('Watch');
export const posting = (
  title: string,
  detail: string,
  action: TabAction | null = watch,
): PostingRow => ({ title, detail, action });

export const closed = (title: string): TournamentPanel => ({
  kind: 'closed',
  title,
});
