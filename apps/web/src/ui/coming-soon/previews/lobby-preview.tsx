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
