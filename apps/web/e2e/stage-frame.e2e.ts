import { expect, test } from './support/fixtures';

/**
 * The frame Egress records, on the real page: the production stylesheet, the
 * self-hosted faces and the start signal. The stage's read is answered here, so no
 * Round or capture is needed; without a room the link stays reconnecting, which is
 * the frame a speech shows until its room is joined.
 */
const seats = [
  {
    side: 'affirmative',
    label: 'Ann',
    kind: 'human',
    identity: 'aff',
    floor: true,
  },
  {
    side: 'negative',
    label: 'Ned',
    kind: 'human',
    identity: 'neg',
    floor: false,
  },
];
/** The stage draws by the answer's own instant, so a fixed one gives fixed clocks. */
const NOW_MS = Date.parse('2026-11-02T00:00:00.000Z');
const answerWith = (phase: Readonly<Record<string, unknown>>) => ({
  ...phase,
  seats,
  debaterIdentities: [],
  nowMs: NOW_MS,
  room: null,
});
const soon = (ms: number) => new Date(NOW_MS + ms).toISOString();

test('the recorded frame is the brand’s slate, and recording starts once its faces have loaded', async ({
  page,
}) => {
  let phase: Readonly<Record<string, unknown>> = {
    phase: 'prep',
    endsAt: soon(90_000),
  };
  await page.route('**/api/stage/e2e-frame', (route) =>
    route.fulfill({ json: answerWith(phase) }),
  );
  const signals: string[] = [];
  const facesAtStart: string[] = [];
  page.on('console', (message) => {
    if (message.text() === 'START_RECORDING') signals.push(message.text());
  });
  await page.exposeFunction('recordFaces', (faces: string) => {
    facesAtStart.push(faces);
  });
  // Reads which of the frame's own faces were loaded at the instant the signal was logged.
  await page.addInitScript(() => {
    // eslint-disable-next-line no-console
    const log = console.log.bind(console);
    // eslint-disable-next-line no-console
    console.log = (...args: unknown[]) => {
      if (args[0] === 'START_RECORDING') {
        const theme = getComputedStyle(document.documentElement);
        const loaded = ['--font-face-display', '--font-face-sans'].map(
          (face) => {
            const family = theme.getPropertyValue(face).split(',')[0]?.trim();
            return [...document.fonts].some(
              (font) =>
                font.status === 'loaded' &&
                `'${font.family.replaceAll(/['"]/g, '')}'` ===
                  `'${(family ?? '').replaceAll(/['"]/g, '')}'`,
            )
              ? 'loaded'
              : `missing ${family}`;
          },
        );
        void (
          window as unknown as { recordFaces: (faces: string) => void }
        ).recordFaces(loaded.join(', '));
      }
      log(...args);
    };
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/stage/e2e-frame?c=any');

  const frame = page.locator('.broadcast-stage');
  const slate = page.locator('.broadcast-stage-slate');
  await expect(
    page.getByRole('heading', { name: 'Preparation' }),
  ).toBeVisible();
  await expect.poll(() => signals).toEqual(['START_RECORDING']);
  expect(facesAtStart).toEqual(['loaded, loaded']);
  expect(await frame.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  await expect(slate).toHaveCSS('background-color', 'rgb(23, 59, 42)');
  await expect(slate.locator('strong')).toHaveText('1:30');
  await expect(slate).toContainText('Ann');
  await expect(slate).toContainText('Ned');
  await expect(page.locator('.broadcast-stage-brand')).toContainText(
    'Daisy Debate',
  );
  // Every tile keeps its place under the slate and shows nothing.
  await expect(page.locator('.broadcast-stage-tile')).toHaveCount(2);
  for (const tile of await page.locator('.broadcast-stage-tile').all())
    await expect(tile).toBeHidden();

  phase = {
    phase: 'between',
    endsAt: null,
    next: { label: 'First negative rebuttal' },
  };
  await expect(
    page.getByRole('heading', { name: 'Next speech soon' }),
  ).toBeVisible();
  await expect(slate).toContainText('Next: First negative rebuttal');
  await expect(slate.locator('strong')).toHaveCount(0);

  phase = {
    phase: 'speech',
    clock: { label: 'First negative rebuttal', endsAt: soon(240_000) },
  };
  await expect(page.getByText('Reconnecting to the debate')).toBeVisible();
  await expect(slate).toHaveCount(0);
  await expect(frame).toHaveCSS('background-color', 'rgb(13, 24, 18)');
  const header = page.locator('.broadcast-stage-clock');
  await expect(header).toContainText('First negative rebuttal');
  await expect(header.locator('strong')).toHaveText('4:00');
  await expect(page.locator('.broadcast-stage-name em')).toHaveText('Speaking');

  // An answer from another deploy's shape is no new answer: the frame keeps the speech.
  phase = { phase: 'prep', clock: null };
  const stageRead = () =>
    page.waitForResponse((response) =>
      response.url().includes('/api/stage/e2e-frame'),
    );
  await stageRead();
  await stageRead();
  await expect(header).toContainText('First negative rebuttal');
  await expect(slate).toHaveCount(0);
  expect(signals).toEqual(['START_RECORDING']);
});
