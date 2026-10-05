import { judgeBallot } from '../../mock/coming-soon';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Judge hub and ballot replace this composition. */
export function JudgePreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Judge" />
      <Panel title="Assigned to you">
        <p className="text-md font-strong text-ink">
          Resolved: Cities should fund public transit first
        </p>
        <p className="mb-3 text-sm text-ink-muted">Starts in 12 min</p>
        <Button>Open ballot</Button>
      </Panel>
      <Panel title="Ballot">
        <PreviewRows rows={judgeBallot} />
      </Panel>
    </PreviewPage>
  );
}
