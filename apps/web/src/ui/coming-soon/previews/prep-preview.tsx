import { prepLibrary } from '../../mock/coming-soon';
import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { Panel } from '../../components/panel/panel';
import { Stat } from '../../components/stat/stat';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Prep library replaces this composition. */
export function PrepPreview() {
  return (
    <PreviewPage>
      <PreviewHeader title="Prep" actions={<Button>New brief</Button>} />
      <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-4 py-3 text-base text-ink-faint">
        <Icon name="search" size={16} />
        Search briefs, cases and evidence cards
      </div>
      <div className="flex gap-4">
        <Stat value="12" label="briefs" />
        <Stat value="148" label="evidence cards" />
        <Stat value="4" label="cases" />
      </div>
      <Panel title="Library">
        <PreviewRows rows={prepLibrary} />
      </Panel>
    </PreviewPage>
  );
}
