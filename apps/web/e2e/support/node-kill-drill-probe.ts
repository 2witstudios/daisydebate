import type { Page } from '@playwright/test';
import type {
  IceTransport,
  SeatRead,
} from '../../scripts/node-kill-drill/measure';

declare global {
  interface Window {
    __drillConnections?: Set<RTCPeerConnection>;
  }
}

/** Records each peer connection the page opens; the media path is read from their stats. */
export const watchPeerConnections = (page: Page) =>
  page.addInitScript(() => {
    const connections = new Set<RTCPeerConnection>();
    window.__drillConnections = connections;
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        connections.add(this);
      }
    };
  });

export type SeatProbe = SeatRead & {
  readonly transports: readonly IceTransport[];
  readonly statuses: readonly string[];
};

/** What this seat shows and receives now: its bar, its peer's elements and its stats. */
export const probeSeat = (page: Page) =>
  page.evaluate(async (): Promise<SeatProbe> => {
    const statuses = [...document.querySelectorAll('[role="status"]')]
      .map((node) => (node.textContent ?? '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 5);
    const connected = [...document.querySelectorAll('[role="status"]')].some(
      (node) =>
        /^Connected( Sound is blocked by your browser\. Press Enable sound to play it\.)?$/.test(
          (node.textContent ?? '').trim(),
        ) && !/Sound is blocked/.test(node.textContent ?? ''),
    );
    const peerCamera = [
      ...document.querySelectorAll<HTMLVideoElement>(
        '[aria-label="Participant camera"]',
      ),
    ].some((video) => video.videoWidth > 0 && video.readyState >= 2);
    const peerAudio = [
      ...document.querySelectorAll<HTMLAudioElement>(
        '[aria-label="Participant audio"]',
      ),
    ].some(
      (audio) =>
        !audio.paused &&
        audio.readyState >= 2 &&
        Boolean(
          (audio.srcObject as MediaStream | null)
            ?.getAudioTracks()
            .some((track) => track.readyState === 'live'),
        ),
    );
    let inboundVideoBytes = 0;
    let inboundAudioBytes = 0;
    const transports: IceTransport[] = [];
    for (const connection of window.__drillConnections ?? []) {
      if (connection.connectionState === 'closed') {
        window.__drillConnections?.delete(connection);
        continue;
      }
      const stats = await connection.getStats();
      const all = [...stats.values()] as (Record<string, never> & {
        type: string;
      })[];
      for (const report of all)
        if (report.type === 'inbound-rtp') {
          const bytes = Number(report.bytesReceived ?? 0);
          if (String(report.kind) === 'video') inboundVideoBytes += bytes;
          if (String(report.kind) === 'audio') inboundAudioBytes += bytes;
        }
      const transport = all.find((report) => report.type === 'transport');
      const pair = stats.get(String(transport?.selectedCandidatePairId));
      if (!pair) continue;
      const remote = stats.get(pair.remoteCandidateId);
      const local = stats.get(pair.localCandidateId);
      if (!remote) continue;
      // The publisher's path counts as much as the subscriber's: a seat with
      // no inbound media yet still shows which node holds it.
      transports.push({
        protocol: String(remote.protocol),
        address: String(remote.address),
        port: Number(remote.port),
        candidateType: String(local?.candidateType ?? remote.candidateType),
      });
    }
    return {
      connected,
      peerCamera,
      peerAudio,
      inboundVideoBytes,
      inboundAudioBytes,
      transports,
      statuses,
    };
  });
