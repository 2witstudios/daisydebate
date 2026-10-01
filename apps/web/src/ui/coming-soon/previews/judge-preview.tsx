import { judgeBallot } from '../../mock/coming-soon';
import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Judge hub and ballot replace this composition. */
export function JudgePreview() {
  return (
    <PreviewPage>
      <PreviewHeader
        title="Judge"
        lede="Judge assigned debates and submit ballots."
      />
      <Panel title="Assigned to you">
        <p className="text-md font-strong text-ink">Resolved: [resolution]</p>
        <p className="mb-3 text-sm text-ink-muted">
          Ratings are hidden while you judge · starts in 12 min
        </p>
        <Button>Open ballot</Button>
      </Panel>
      <Panel
        title="Ballot"
        action={<Badge tone="neutral">Sample scores</Badge>}
      >
        <PreviewRows rows={judgeBallot} />
      </Panel>
    </PreviewPage>
  );
}
