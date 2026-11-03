import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MediaStage } from '../../src/features/round-media/media-stage';
import { view } from '../../src/ui/debate-room/live-round.test-support';
import type { TrackHandle } from '../../src/features/round-media/adapters/livekit-room';
const root = createRoot(document.getElementById('root')!);
const calls: string[] = [];
const sdk = (id: string) => ({
  attach: () => calls.push(`attach ${id}`),
  detach: () => calls.push(`detach ${id}`),
});
const tracks = [sdk('first'), sdk('second')];
const seat = view.participants.find(
  (p) => p.kind === 'human' && p.role !== 'judge',
)!;
const media = {
  peers: [
    {
      participantId: 'id' in seat ? seat.id : '',
      identity: 'peer',
      microphone: true,
    },
  ],
} as Parameters<typeof MediaStage>[0]['media'];
Object.assign(window, {
  stage: {
    render(index: number, speaking: boolean) {
      flushSync(() =>
        root.render(
          <MediaStage
            view={view}
            media={media}
            connection="live"
            microphoneConfirmed
            ownIdentity={null}
            ownMuted={false}
            remotePeers={[{ identity: 'peer', microphonePublished: false }]}
            tracks={[
              {
                identity: 'peer',
                source: 'camera',
                local: false,
                speaking,
                muted: false,
              },
            ]}
            handles={[
              {
                identity: 'peer',
                source: 'camera',
                track: tracks[index],
              } as unknown as TrackHandle,
            ]}
          />,
        ),
      );
      return [...calls];
    },
    unmount() {
      flushSync(() => root.unmount());
      return [...calls];
    },
  },
});
