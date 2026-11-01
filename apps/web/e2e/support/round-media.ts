import type { Page } from '@playwright/test';
import { expect, openPage } from './fixtures';
import { roomViewSchema } from '@daisy/protocol';
import {
  createFoundationRoom,
  claimSeat,
  startAdmittedRound,
} from './human-ballot-round';
import { humanRoundSelection } from './human-round-selection';
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
      if (
        mode === 'camera-failure' &&
        location.pathname.startsWith('/rounds/') &&
        constraints?.video
      )
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

/** Actual Room checks and Ready precede the canonical API start; no storage is seeded. */
export async function openCheckedMediaRound(
  members: Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'],
  prepare: (page: Page, index: number) => Promise<unknown>,
) {
  if (members.length !== 2) throw new Error('Two media debaters required');
  const host = members[0]!;
  let room = await createFoundationRoom(host, (choice) =>
    humanRoundSelection(choice, 0),
  );
  for (const [index, member] of members.entries())
    room = await claimSeat(member, room, {
      role: index === 0 ? 'affirmative' : 'negative',
      slot: 0,
    });
  const pages = await Promise.all(
    members.map((member, index) =>
      openPage(member.context, `checked media debater ${index + 1}`),
    ),
  );
  for (const [index, page] of pages.entries()) {
    await prepare(page, index);
    await page.goto(`/rooms/${room.id}`);
    for (const kind of ['camera', 'microphone']) {
      await page
        .getByRole('button', { name: `Check ${kind}`, exact: true })
        .click();
      await expect(
        page.getByText(`✓ ${kind === 'camera' ? 'Camera' : 'Microphone'}`, {
          exact: true,
        }),
      ).toBeVisible(MEDIA_POLL);
    }
    await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Not ready', exact: true }),
    ).toBeEnabled();
  }
  await expect(async () => {
    const response = await host.context.request.get(`/api/rooms/${room.id}`);
    expect(response.status()).toBe(200);
    room = roomViewSchema.parse(await response.json());
    expect(room.capabilities.canStart).toBe(true);
  }).toPass();
  const round = await startAdmittedRound(host, room);
  for (const page of pages)
    await expect(page).toHaveURL(new RegExp(`/rounds/${round.id}/room$`));
  return { round, pages };
}
