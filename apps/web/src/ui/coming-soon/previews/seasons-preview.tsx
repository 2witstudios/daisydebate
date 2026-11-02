import { leaderboardRows, seasonsResolutions } from '../../mock/coming-soon';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Seasons page replaces this composition. */
export function SeasonsPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Seasons" />
      <Panel title="Resolutions">
        <PreviewRows rows={seasonsResolutions} />
      </Panel>
      <Panel title="Standings now">
        <PreviewRows rows={leaderboardRows} />
      </Panel>
    </PreviewPage>
  );
}
