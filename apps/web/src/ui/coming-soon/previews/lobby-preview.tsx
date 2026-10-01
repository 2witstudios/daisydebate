import { lobbyRooms } from '../../mock/coming-soon';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { PreviewHeader, PreviewPage, PreviewRows } from './preview-parts';

/** Swap point: the real Lobby list replaces this composition. */
export function LobbyPreview() {
  return (
    <PreviewPage>
      <PreviewHeader
        title="Lobby"
        lede="Open tables and live rooms to watch."
        actions={
          <>
            <Button variant="secondary">Open a table</Button>
            <Button>Find a match</Button>
          </>
        }
      />
      <Panel title="Rooms">
        <PreviewRows rows={lobbyRooms} />
      </Panel>
    </PreviewPage>
  );
}
