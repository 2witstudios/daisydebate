import { leaderboardRows } from '../../mock/coming-soon';
import { Badge } from '../../components/badge/badge';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Leaderboard replaces this composition. */
export function LeaderboardPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Leaderboard" />
      <Panel title="Season 3" action={<Badge tone="accent">One ladder</Badge>}>
        <PreviewRows rows={leaderboardRows} />
      </Panel>
    </PreviewPage>
  );
}
