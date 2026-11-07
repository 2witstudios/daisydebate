import type { Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import {
  roomViewSchema,
  roundViewSchema,
  serverMessageSchema,
} from '@daisy/protocol';
import { foundationSelection } from '../../integration/foundation-selection.test-support';
import { expect, openPage, test } from './fixtures';
import { origin, signUpMember } from './accounts';
import { createLaunchContexts } from './room-launch-contexts';
import { claim, startRoundInBrowser } from './room-launch-flow';
import { countMediaAdmissions, expectConnected } from './round-media';
import { createMemberDocument } from './live-room-documents';
import { forfeitOwnSeat, settleLeftRounds } from './settle-left-round';
import {
  proveFloorOlderDraft,
  revealFloorMessage,
} from './round-floor-pagination';
import { proveFloorControlFocus } from './round-floor-controls';
import { proveFloorResilience } from './round-floor-resilience';

const floor = (page: Page) =>
  page.getByRole('region', { name: 'Round floor chat', exact: true });
const composer = (page: Page) =>
  floor(page).getByRole('textbox', {
    name: 'Message debaters and host',
    exact: true,
  });
const message = (page: Page, text: string) =>
  floor(page)
    .getByRole('list', { name: 'Floor messages' })
    .getByRole('paragraph')
    .filter({ hasText: text });

async function readyFloorDebater(page: Page) {
  for (const kind of ['camera', 'microphone'] as const) {
    await page
      .getByRole('button', { name: `Check ${kind}`, exact: true })
      .click({ timeout: 15_000 });
    try {
      await expect(
        page.getByText(kind === 'camera' ? '✓ Camera' : '✓ Microphone', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 15_000 });
    } catch (cause) {
      const diagnostic = await page.evaluate(async (kind) => {
        const policy = (
          document as Document & {
            featurePolicy?: { allowsFeature(name: string): boolean };
          }
        ).featurePolicy;
        const context = {
          secure: isSecureContext,
          cameraAllowed: policy?.allowsFeature('camera'),
          microphoneAllowed: policy?.allowsFeature('microphone'),
        };
        try {
          const stream = await navigator.mediaDevices.getUserMedia(
            kind === 'camera'
              ? { video: true, audio: false }
              : { audio: true, video: false },
          );
          const tracks = stream.getTracks().map((track) => ({
            kind: track.kind,
            readyState: track.readyState,
          }));
          let videoResult: string | null = null;
          if (kind === 'camera') {
            const video = document.createElement('video');
            video.muted = true;
            video.srcObject = stream;
            try {
              await video.play();
              videoResult = await Promise.race([
                new Promise<string>((resolve) =>
                  video.requestVideoFrameCallback(() =>
                    resolve(`frame:${video.videoWidth}x${video.videoHeight}`),
                  ),
                ),
                new Promise<string>((resolve) =>
                  setTimeout(() => resolve('no-frame'), 2000),
                ),
              ]);
            } catch (error) {
              videoResult =
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : 'play failed';
            }
            video.pause();
            video.srcObject = null;
          }
          stream.getTracks().forEach((track) => track.stop());
          return { ...context, capture: 'opened', tracks, videoResult };
        } catch (error) {
          return {
            ...context,
            capture: 'failed',
            name: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message : 'unknown',
          };
        }
      }, kind);
      throw new Error(
        `Native ${kind} check failed: ${JSON.stringify(diagnostic)}`,
        { cause },
      );
    }
  }
  await page
    .getByRole('button', { name: 'I’m ready', exact: true })
    .click({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: 'Not ready', exact: true }),
  ).toBeVisible();
}

/** Real durable floor operations and native observation permits, with no intercepted floor responses. */
export function testRoundFloorLive() {
  test('Round floor prep messages reach both debaters without replacing drafts, documents or media, and retain read-only history', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await createLaunchContexts(
      3,
      () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
      (context) => signUpMember(context.request),
    );
    let roundId: string | undefined;
    try {
      for (const member of accounts.members.slice(0, 2))
        await member.context.grantPermissions(
          ['camera', 'microphone', 'local-network-access'],
          { origin },
        );
      const host = await openPage(
        accounts.members[0]!.context,
        'floor host debater',
      );
      const peer = await openPage(
        accounts.members[1]!.context,
        'floor other debater',
      );
      const mediaAdmissions = countMediaAdmissions(peer);
      let floorChannelId: string | null = null;
      const snapshots: number[] = [];
      peer.on('websocket', (socket) =>
        socket.on('framereceived', (frame) => {
          let raw: unknown;
          try {
            raw = JSON.parse(String(frame.payload));
          } catch {
            return;
          }
          const parsed = serverMessageSchema.safeParse(raw);
          if (
            parsed.success &&
            parsed.data.type === 'observation.snapshot' &&
            parsed.data.resource.kind === 'channel-messages' &&
            parsed.data.resource.id === floorChannelId
          )
            snapshots.push(parsed.data.contentRevision);
        }),
      );
      const created = await host.request.post('/api/rooms', {
        headers: { origin },
        data: {
          commandId: createId(),
          title: `Floor proof ${createId().slice(0, 8)}`,
          resolution: { kind: 'custom', text: 'Cities should fund transit' },
          visibility: 'public',
          selection: {
            ...foundationSelection,
            definition: {
              ...foundationSelection.definition,
              configurable: {
                ...foundationSelection.definition.configurable,
                preRoundPrep: { durationMs: { min: 30_000, max: 120_000 } },
              },
            },
            config: {
              ...foundationSelection.config,
              preRoundPrep: { enabled: true, durationMs: 30_000 },
            },
          },
        },
      });
      expect(created.status()).toBe(201);
      const room = roomViewSchema.parse((await created.json()).view);
      await claim(host, room, 'Affirmative 1');
      await claim(peer, room, 'Negative 1');
      await host.reload();
      await readyFloorDebater(host);
      await readyFloorDebater(peer);
      roundId = await startRoundInBrowser(host);
      await expect(peer).toHaveURL(host.url());
      const read = await host.request.get(`/api/rounds/${roundId}`);
      expect(read.status()).toBe(200);
      const opening = roundViewSchema.parse(await read.json());
      expect(opening.status).toBe('opening');
      expect(opening.opening?.step.step).toBe('prep');
      const document = await createMemberDocument(peer.request);
      await peer.reload();
      const editor = peer.getByRole('textbox', {
        name: 'Untitled',
        exact: true,
      });
      await expect(editor).toBeVisible();
      await editor.fill('Notes stay open while floor messages arrive.');
      await expectConnected(peer);
      const admissionCount = mediaAdmissions();
      expect(admissionCount).toBeGreaterThan(0);
      const media = peer.getByRole('region', {
        name: 'Live camera and sound',
        exact: true,
      });
      await media.evaluate((element) =>
        element.setAttribute('data-floor-witness', 'media-before-message'),
      );
      await editor.evaluate((element) =>
        element.setAttribute('data-floor-witness', 'document-before-message'),
      );
      for (const page of [host, peer]) {
        await page.getByRole('tab', { name: 'Channels', exact: true }).click();
        await expect(
          floor(page).getByRole('heading', {
            name: 'Debaters and host',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          floor(page).getByText('The host can read this chat.', {
            exact: true,
          }),
        ).toBeVisible();
        await expect(composer(page)).toBeEditable();
      }
      const discovered = await host.request.get(`/api/rounds/${roundId}/floor`);
      expect(discovered.status()).toBe(200);
      const channelId: string = (await discovered.json()).channel.channelId;
      floorChannelId = channelId;
      const snapshotsBeforeSend = snapshots.length;
      const draft = 'Keep this peer draft across snapshots and tabs';
      await composer(peer).fill(draft);
      await composer(peer).evaluate((element) =>
        element.setAttribute('data-floor-witness', 'draft-before-message'),
      );
      await composer(peer).evaluate((element) => {
        const field = element as HTMLTextAreaElement;
        field.setSelectionRange(5, 16, 'backward');
      });
      const documentSelection = await editor.evaluate((element) => {
        const node = document
          .createTreeWalker(element, NodeFilter.SHOW_TEXT)
          .nextNode();
        if (!node) throw new Error('Document selection requires actual text');
        (element as HTMLElement).focus();
        const selection = window.getSelection();
        if (!selection) throw new Error('Document selection unavailable');
        selection.setBaseAndExtent(node, 6, node, 20);
        (
          element as HTMLElement & { floorSelectionNode?: Node }
        ).floorSelectionNode = node;
        return {
          anchor: selection.anchorOffset,
          focus: selection.focusOffset,
          text: selection.toString(),
        };
      });
      const prepRead = await host.request.get(`/api/rounds/${roundId}`);
      expect(
        roundViewSchema.parse(await prepRead.json()).opening?.step.step,
      ).toBe('prep');
      const first = 'Prep floor message from the host';
      await composer(host).fill(first);
      await floor(host)
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(message(host, first)).toBeVisible();
      await expect(message(peer, first)).toBeVisible();
      await expect
        .poll(() => snapshots.length)
        .toBeGreaterThan(snapshotsBeforeSend);
      await expect(composer(peer)).toHaveValue(draft);
      expect(
        await composer(peer).evaluate((element) => {
          const field = element as HTMLTextAreaElement;
          return [
            field.selectionStart,
            field.selectionEnd,
            field.selectionDirection,
          ];
        }),
      ).toEqual([5, 16, 'backward']);
      expect(mediaAdmissions()).toBe(admissionCount);
      // Prep intentionally publishes no tracks. Once the real opening ends,
      // witness the actual publications before another floor snapshot arrives.
      const videos = media.locator('video');
      await expect
        .poll(
          () =>
            videos.evaluateAll((elements) =>
              elements.some((element) => {
                const video = element as HTMLVideoElement;
                return (
                  video.srcObject instanceof MediaStream &&
                  video.srcObject
                    .getTracks()
                    .some((track) => track.readyState === 'live')
                );
              }),
            ),
          { timeout: 45_000 },
        )
        .toBe(true);

      await videos.evaluateAll((elements) => {
        for (const element of elements) {
          const video = element as HTMLVideoElement & {
            floorProof?: { stream: MediaStream; tracks: MediaStreamTrack[] };
          };
          if (video.srcObject instanceof MediaStream)
            video.floorProof = {
              stream: video.srcObject,
              tracks: video.srcObject.getTracks(),
            };
        }
      });
      expect(
        await videos.evaluateAll((elements) =>
          elements.some((element) => {
            const video = element as HTMLVideoElement & {
              floorProof?: { tracks: MediaStreamTrack[] };
            };
            return Boolean(video.floorProof?.tracks.length);
          }),
        ),
      ).toBe(true);

      const witnessedVideos = await videos.evaluateAll(
        (elements) =>
          elements.filter((element) =>
            Boolean(
              (element as HTMLVideoElement & { floorProof?: unknown })
                .floorProof,
            ),
          ).length,
      );
      const activeRead = await host.request.get(`/api/rounds/${roundId}`);
      expect(roundViewSchema.parse(await activeRead.json()).status).toBe(
        'active',
      );
      const liveAdmissionCount = mediaAdmissions();
      const second = 'Floor message alongside the live camera';
      await composer(host).fill(second);
      await floor(host)
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(message(host, second)).toBeVisible();
      await expect(message(peer, second)).toBeVisible();
      await expect(composer(peer)).toHaveValue(draft);
      expect(
        await videos.evaluateAll(
          (elements, witnessedVideos) =>
            elements.filter((element) =>
              Boolean(
                (element as HTMLVideoElement & { floorProof?: unknown })
                  .floorProof,
              ),
            ).length === witnessedVideos &&
            elements.every((element) => {
              const video = element as HTMLVideoElement & {
                floorProof?: {
                  stream: MediaStream;
                  tracks: MediaStreamTrack[];
                };
              };
              const proof = video.floorProof;
              return (
                !proof ||
                (video.srcObject === proof.stream &&
                  proof.tracks.every(
                    (track, index) =>
                      video.srcObject instanceof MediaStream &&
                      video.srcObject.getTracks()[index] === track &&
                      track.readyState === 'live',
                  ))
              );
            }),
          witnessedVideos,
        ),
      ).toBe(true);

      await expect(composer(peer)).toHaveAttribute(
        'data-floor-witness',
        'draft-before-message',
      );
      await expect(editor).toHaveAttribute(
        'data-floor-witness',
        'document-before-message',
      );
      expect(
        await editor.evaluate((element) => {
          const selection = window.getSelection();
          const node = (element as HTMLElement & { floorSelectionNode?: Node })
            .floorSelectionNode;
          return {
            sameNode:
              selection?.anchorNode === node && selection?.focusNode === node,
            anchor: selection?.anchorOffset,
            focus: selection?.focusOffset,
            text: selection?.toString(),
          };
        }),
      ).toEqual({ sameNode: true, ...documentSelection });

      await expect(editor).toContainText(
        'Notes stay open while floor messages arrive.',
      );
      await expect(media).toHaveAttribute(
        'data-floor-witness',
        'media-before-message',
      );
      await expectConnected(peer);
      expect(mediaAdmissions()).toBe(liveAdmissionCount);
      await peer.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await peer.getByRole('tab', { name: /^Channels/ }).click();
      await expect(composer(peer)).toHaveValue(draft);
      await floor(peer)
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(message(peer, draft)).toBeVisible();
      await expect(message(host, draft)).toBeVisible();
      const outsider = await accounts.members[2]!.context.request.get(
        `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
      );
      expect(outsider.status()).toBe(404);
      const history = await peer.request.get(
        `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
      );
      expect(history.status()).toBe(200);
      expect(
        (await history.json()).history.messages.map(
          (item: { text: string }) => item.text,
        ),
      ).toEqual([draft, second, first]);
      await proveFloorControlFocus(host, peer);
      await proveFloorResilience({ host, peer, roundId, channelId });
      const retainedOwnText = await proveFloorOlderDraft({
        host,
        peer,
        roundId,
        channelId,
        ownText: first,
        peerText: draft,
      });
      // The durable document remains the same entity after all floor mutations.
      expect(document.id).toMatch(/^[a-z0-9]{24}$/);
      await expect(editor).toHaveAttribute(
        'data-floor-witness',
        'document-before-message',
      );
      await forfeitOwnSeat(
        host.request,
        roundId,
        (seat) => seat.role === 'affirmative',
      );
      for (const page of [host, peer]) {
        await page.goto(`/rounds/${roundId}/floor`);
        await revealFloorMessage(page, retainedOwnText);
        await expect(message(page, retainedOwnText)).toBeVisible();
        await expect(message(page, second)).toBeVisible();
        await expect(message(page, draft)).toBeVisible();
        await expect(
          floor(page).getByText('This Round chat is read-only.', {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          floor(page).getByRole('button', {
            name: 'Send message',
            exact: true,
          }),
        ).toBeDisabled();
        await expect(composer(page)).not.toBeEditable();
        await composer(page).evaluate((element) => {
          const field = element as HTMLTextAreaElement;
          const form = field.form;
          if (!form) throw new Error('Composer form missing');
          form.dataset.floorSubmitWitness = '0';
          form.addEventListener('submit', () => {
            form.dataset.floorSubmitWitness = String(
              Number(form.dataset.floorSubmitWitness) + 1,
            );
          });
        });
        await composer(page).focus();
        await composer(page).press('Enter');
        await expect(floor(page).locator('form').last()).toHaveAttribute(
          'data-floor-submit-witness',
          '0',
        );
      }
    } finally {
      if (roundId)
        await forfeitOwnSeat(
          accounts.members[0]!.context.request,
          roundId,
          (seat) => seat.role === 'affirmative',
        );
      await settleLeftRounds(accounts.members);
      await accounts.closeContexts();
    }
  });
}
