import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { origin } from './accounts';
import type { createRoomLaunchAccounts } from './room-launch-accounts';

/** Real decoded frames over the launch fixture's TLS edge can take seconds to arrive. */
export const MEDIA_POLL = { timeout: 20_000 };

/** Controlled media still traverses native capture, LiveKit and peer playback. */
export const installMediaCapture = (
  page: Page,
  mode: 'alternating' | 'camera-failure',
) =>
  page.addInitScript((mode) => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (mode === 'camera-failure' && constraints?.video)
        throw new DOMException('controlled camera failure', 'NotReadableError');
      const stream = await capture(constraints);
      if (constraints?.audio) {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        const output = audio.createMediaStreamDestination();
        tone.connect(gain).connect(output);
        if (mode === 'alternating') {
          for (let i = 0; i < 120; i++) {
            gain.gain.setValueAtTime(0.3, audio.currentTime + i * 2);
            gain.gain.setValueAtTime(0, audio.currentTime + i * 2 + 0.5);
          }
        } else gain.gain.value = 0.2;
        tone.start();
        await audio.resume();
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track);
          track.stop();
        }
        for (const track of output.stream.getAudioTracks())
          stream.addTrack(track);
      }
      return stream;
    };
  }, mode);

export const grantMedia = (
  members: Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'],
) =>
  Promise.all(
    members.map(({ context }) =>
      context.grantPermissions(
        ['camera', 'microphone', 'local-network-access'],
        { origin },
      ),
    ),
  );

export const expectConnected = (page: Page) =>
  expect(
    page.getByRole('status').filter({ hasText: /^Connected/ }),
  ).toBeVisible(MEDIA_POLL);
