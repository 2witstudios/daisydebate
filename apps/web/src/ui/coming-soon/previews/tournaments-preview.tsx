import { tournamentBracket, tournamentList } from '../../mock/coming-soon';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Tournaments screens replace this composition. */
export function TournamentsPreview() {
  return (
    <PreviewPage>
      <PreviewHeader
        title="Tournaments"
        actions={<Button>Create a tournament</Button>}
      />
      <Panel title="Events">
        <PreviewRows rows={tournamentList} />
      </Panel>
      <Panel title="Spring Open · bracket">
        <PreviewRows rows={tournamentBracket} />
      </Panel>
    </PreviewPage>
  );
}
