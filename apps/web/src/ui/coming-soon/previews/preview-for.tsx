import type { ReactNode } from 'react';
import type { DestinationSlug } from '../../../features/coming-soon/destinations';
import { JudgePreview } from './judge-preview';
import { LeaderboardPreview } from './leaderboard-preview';
import { LobbyPreview } from './lobby-preview';
import { PrepPreview } from './prep-preview';
import { RankedPreview } from './ranked-preview';
import { TournamentsPreview } from './tournaments-preview';
import { TrainPreview } from './train-preview';
import { WatchPreview } from './watch-preview';

const previews: Readonly<Record<DestinationSlug, () => ReactNode>> = {
  ranked: RankedPreview,
  lobby: LobbyPreview,
  watch: WatchPreview,
  judge: JudgePreview,
  tournaments: TournamentsPreview,
  leaderboard: LeaderboardPreview,
  train: TrainPreview,
  prep: PrepPreview,
};

/** The sample composition of a destination's finished page. */
export const previewFor = (slug: DestinationSlug): ReactNode =>
  previews[slug]();
