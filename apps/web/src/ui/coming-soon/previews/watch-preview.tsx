import { watchRooms } from '../../mock/coming-soon';
import { Badge } from '../../components/badge/badge';
import { Panel } from '../../components/panel/panel';
import { Stat } from '../../components/stat/stat';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Watch screens replace this composition. */
export function WatchPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Watch" />
      <Panel title="Live now">
        <div className="mb-3 flex items-center gap-3">
          <Badge tone="live">Live</Badge>
          <Stat value="14" label="watching" icon="eye" />
        </div>
        <p className="text-md font-strong text-ink">@debater-a vs @debater-b</p>
        <p className="text-sm text-ink-muted">Aff speaking · 02:41 left</p>
      </Panel>
      <Panel title="More live rooms">
        <PreviewRows rows={watchRooms} />
      </Panel>
    </PreviewPage>
  );
}
