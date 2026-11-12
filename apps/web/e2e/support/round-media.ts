import type { BrowserContext, Page } from '@playwright/test';
import { expect, openPage } from './fixtures';
import { roomViewSchema, roundMediaStateSchema } from '@daisy/protocol';
import {
  createFoundationRoom,
  claimSeat,
  createHumanBallotRound,
  startAdmittedRound,
} from './human-ballot-round';
import { humanRoundSelection } from './human-round-selection';
import type { ProofChoice } from './human-round-selection';
import { origin } from './accounts';
import type { createRoomLaunchAccounts } from './room-launch-accounts';

/** Real decoded frames over the launch fixture's TLS edge can take seconds to arrive. */
export const MEDIA_POLL = { timeout: 20_000 };

/** Controlled media still traverses native capture, LiveKit and peer playback. */
export const installMediaCapture = (
  page: Page,
  mode:
    'alternating' | 'camera-failure' | 'microphone-failure' | 'capture-failure',
) =>
  page.addInitScript((mode) => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const inRound = () => location.pathname.startsWith('/rounds/');
    const refused = (constraints?: MediaStreamConstraints) =>
      inRound() &&
      ((mode === 'camera-failure' && constraints?.video) ||
        (mode === 'microphone-failure' && constraints?.audio) ||
        mode === 'capture-failure');
    const withTone = async (stream: MediaStream) => {
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
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (refused(constraints))
        throw new DOMException(
          'controlled capture failure',
          'NotReadableError',
        );
      const stream = await capture(constraints);
      // The Room check records the native device; only Round capture gets the tone.
      if (constraints?.audio && inRound()) await withTone(stream);
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

/** A live two-seat Round whose members may capture, with its first member's page. */
export async function openGrantedRound(
  members: Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'],
  label: string,
) {
  const round = await createHumanBallotRound(members, 0);
  const owner = members[0]!;
  await grantMedia(members);
  const page = await openPage(owner.context, label);
  return { round, owner, page };
}

/** A two-seat Round whose debaters may capture; the journey opens its own pages. */
export async function grantedDebaters(
  members: Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'],
  choice?: ProofChoice,
  countdownMs = 0,
) {
  const round = await createHumanBallotRound(members, 0, countdownMs, choice);
  const [speaker, listener] = members;
  if (!speaker || !listener) throw new Error('Two actual members required');
  await grantMedia(members);
  return { round, speaker, listener };
}

/** What the server says this member may do now, read outside the page under test. */
export async function readMediaState(
  member: { readonly context: BrowserContext },
  roundId: string,
) {
  const response = await member.context.request.get(
    `/api/rounds/${roundId}/media`,
  );
  expect(response.status()).toBe(200);
  return roundMediaStateSchema.parse(await response.json());
}

/**
 * Media sessions this page asked for, less those answered with a status the
 * client retries (media-failure.ts): such an ask admitted nobody, and retrying it
 * is designed (ADR 0088). An ask still in flight counts, so a second admission
 * cannot hide behind its slow answer.
 */
export const countMediaAdmissions = (page: Page) => {
  const isSession = (url: string) =>
    new URL(url).pathname.endsWith('/media/session');
  let admissions = 0;
  page.on('request', (request) => {
    if (isSession(request.url())) admissions++;
  });
  page.on('response', (response) => {
    const status = response.status();
    if (
      isSession(response.url()) &&
      (status === 408 || status === 429 || status >= 500)
    )
      admissions--;
  });
  return () => admissions;
};

/** Healthy only: a degraded bar names its problem and fails this. */
export const expectConnected = (page: Page) =>
  expect(
    page.getByRole('status').filter({
      hasText:
        /^Connected( Sound is blocked by your browser\. Press Enable sound to play it\.)?$/,
    }),
  ).toBeVisible(MEDIA_POLL);

/** Actual decoded frames from a remote participant, not a grant or a track object. */
export const expectPeerCamera = (page: Page) =>
  expect
    .poll(
      () =>
        page
          .getByLabel('Participant camera', { exact: true })
          .evaluateAll((nodes) =>
            nodes.some((node) => {
              const video = node as HTMLVideoElement;
              return video.videoWidth > 0 && video.readyState >= 2;
            }),
          ),
      MEDIA_POLL,
    )
    .toBe(true);

/** Actual playing remote audio with a live track; signal is proved separately. */
export const expectPeerAudio = (page: Page) =>
  expect
    .poll(
      () =>
        page
          .getByLabel('Participant audio', { exact: true })
          .evaluateAll((nodes) =>
            nodes.some((node) => {
              const audio = node as HTMLAudioElement;
              return (
                !audio.paused &&
                audio.readyState >= 2 &&
                (audio.srcObject as MediaStream | null)
                  ?.getAudioTracks()
                  .some((track) => track.readyState === 'live')
              );
            }),
          ),
      MEDIA_POLL,
    )
    .toBe(true);

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
        page.getByText(
          `${kind === 'camera' ? 'Camera' : 'Microphone'}: ✓ checked`,
          {
            exact: true,
          },
        ),
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

/** Effects have run on this page, so an automatic redirect would have started. */
export const afterHydration = (page: Page) =>
  page.waitForFunction(
    () =>
      Object.keys(document.querySelector('a, button') ?? {}).some((key) =>
        key.startsWith('__reactProps'),
      ) &&
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done(true))),
      ),
  );
