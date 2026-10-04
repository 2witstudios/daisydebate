import { rankedLadder } from '../../mock/coming-soon';
import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { Stat } from '../../components/stat/stat';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Ranked screen replaces this composition. */
export function RankedPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Ranked" lede="Season 3 · 12 days left" />
      <Panel title="Your rating">
        <div className="mb-2 flex items-center gap-3">
          <span className="font-display text-3xl font-semibold text-ink">
            1412
          </span>
          <Badge tone="neutral">Provisional</Badge>
        </div>
        <Stat
          value="7 of 10"
          label="ranked debates until your rating is established"
        />
      </Panel>
      <Panel title="Play ranked">
        <div className="flex gap-2">
          <Button>Find a match</Button>
          <Button variant="secondary">Host a ranked table</Button>
        </div>
      </Panel>
      <Panel title="Season ladder">
        <PreviewRows rows={rankedLadder} />
      </Panel>
    </PreviewPage>
  );
}
