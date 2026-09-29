import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  EXPECTED_SINGLE_H1_PAGE_SHAPE,
  singleH1PageShape,
} from './confirm-page.test-support';
import { markGeometry, petalShape } from '../../ui/brand/brand-geometry';
import { bloomPetals } from '../../ui/brand/petal';
import { renderConfirmPage } from './confirm-page';
import { confirmPageStylesheet } from './confirm-page-style';

setupRitewayBun();

const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
  'base64',
);

const request = (extra: Record<string, string> = {}) =>
  new Request('https://daisy.invalid/auth/confirm', {
    headers: { 'x-nonce': nonce, ...extra },
  });

const token = 'a'.repeat(32);

const RETRY_NOTICE = {
  lead: 'Too many attempts.',
  rest: 'Wait a minute, then select the button again. Your link still works.',
};

const retryHtml = () =>
  renderConfirmPage(
    {
      kind: 'confirm',
      token,
      hidden: { callbackURL: '/lobby' },
      notice: RETRY_NOTICE,
    },
    request(),
  ).text();

test('renderConfirmPage: the confirm state is a single-h1, script- and asset-free document', async () => {
  const html = await renderConfirmPage(
    { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
    request(),
  ).text();
  assert({
    given: 'the confirm state',
    should:
      'render exactly one <main>, one <h1>, the token exactly once as a hidden value, and nothing loadable',
    actual: {
      ...singleH1PageShape(html, token),
      tokenIsHidden: html.includes(
        `<input type="hidden" name="token" value="${token}">`,
      ),
    },
    expected: { ...EXPECTED_SINGLE_H1_PAGE_SHAPE, tokenIsHidden: true },
  });
});

test('renderConfirmPage: a retry notice carries role="alert"', async () => {
  const html = await retryHtml();
  assert({
    given: 'a confirm view with a notice (the retry state)',
    should: 'render the notice inside a role="alert" element',
    actual: /role="alert"[^>]*>.*Too many attempts/s.test(html),
    expected: true,
  });
});

test('renderConfirmPage: the retry state matches the mock exactly — only the lead sentence bold, no lede', async () => {
  const html = await retryHtml();
  assert({
    given: 'the retry (too many attempts) state',
    should:
      'bold only the lead sentence, keep the rest plain, and drop the confirm lede',
    actual: {
      exactNotice: html.includes(
        '<strong>Too many attempts.</strong> Wait a minute, then select the button again. Your link still works.',
      ),
      noLede: !html.includes(
        'Select the button to sign in to Daisy Debate on this device.',
      ),
    },
    expected: { exactNotice: true, noLede: true },
  });
});

test('renderConfirmPage: each state gets its own <title>, matching the mock', async () => {
  const titles = await Promise.all([
    renderConfirmPage(
      { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
      request(),
    ).text(),
    renderConfirmPage(
      { kind: 'expired', hidden: { callbackURL: '/lobby' } },
      request(),
    ).text(),
    renderConfirmPage({ kind: 'sent' }, request()).text(),
  ]);
  assert({
    given: 'the confirm, expired and sent states',
    should: 'each carry the mock-matching <title>',
    actual: titles.map((html) => /<title>([^<]*)<\/title>/.exec(html)?.[1]),
    expected: [
      'Finish signing in · Daisy Debate',
      'Link expired · Daisy Debate',
      'Check your inbox · Daisy Debate',
    ],
  });
});

test('renderConfirmPage: the expired state escapes an untrusted destination', async () => {
  const html = await renderConfirmPage(
    {
      kind: 'expired',
      hidden: { callbackURL: '/lobby?"><script>alert(1)</script>' },
    },
    request(),
  ).text();
  assert({
    given: 'a destination carrying HTML metacharacters',
    should: 'escape it wherever it is echoed back, never inject markup',
    actual: html.includes('<script>alert(1)</script>'),
    expected: false,
  });
});

test('renderConfirmPage: an absent or malformed nonce renders with no <style> at all (fail safe)', async () => {
  const html = await renderConfirmPage(
    { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
    request({ 'x-nonce': '' }),
  ).text();
  assert({
    given: 'a request with no valid x-nonce',
    should:
      'omit the stylesheet entirely rather than trust an unvalidated nonce',
    actual: html.includes('<style'),
    expected: false,
  });
});

test('renderConfirmPage: a right-length hostile nonce still renders with no <style> (negative control for a loosened shape check)', async () => {
  // Same overall length (24 characters) as a real nonce, so a regression
  // that only checks length (for example `NONCE_SHAPE = /^.{24}$/`) would
  // wrongly accept it; the real shape check refuses it on content.
  const hostile = `${'x'.repeat(20)}"><x`;
  const html = await renderConfirmPage(
    { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
    request({ 'x-nonce': hostile }),
  ).text();
  assert({
    given: 'a 24-character x-nonce header carrying `">` instead of base64',
    should: 'refuse it and render with no <style> at all',
    actual: { length: hostile.length, hasStyle: html.includes('<style') },
    expected: { length: 24, hasStyle: false },
  });
});

test('renderConfirmPage: the style nonce matches the request header exactly', async () => {
  const html = await renderConfirmPage(
    { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
    request(),
  ).text();
  assert({
    given: 'a request carrying a well-formed x-nonce',
    should: 'render <style nonce="..."> with that exact value',
    actual: html.includes(`<style nonce="${nonce}">`),
    expected: true,
  });
});

test('renderConfirmPage: the sent state is a single-h1, script-free document', async () => {
  const html = await renderConfirmPage({ kind: 'sent' }, request()).text();
  assert({
    given: 'the sent state',
    should: 'render exactly one <main> and one <h1>',
    actual: {
      mains: (html.match(/<main/g) ?? []).length,
      h1s: (html.match(/<h1/g) ?? []).length,
    },
    expected: { mains: 1, h1s: 1 },
  });
});

test('renderConfirmPage: draws the Daisy mark from the brand geometry, with no ellipse left', async () => {
  const html = await renderConfirmPage(
    { kind: 'confirm', token, hidden: { callbackURL: '/lobby' } },
    request(),
  ).text();
  const petals = bloomPetals(petalShape, markGeometry).map(({ d }) => d);
  assert({
    given: 'the confirm page with its brand row and stage panel',
    should:
      'draw both marks (the primary logo and the reverse panel art) from bloomPetals, with the logo petals classed by the scheme-following tokens, and no <ellipse> or mask',
    actual: {
      ellipses: html.match(/<ellipse/g)?.length ?? 0,
      everyPetalTwice: petals.every(
        (d) => html.split(`d="${d}"`).length - 1 === 2,
      ),
      logoPetals: html.match(/class="af-logo-(cardinal|diagonal)"/g)?.length,
      masks: html.match(/<mask/g)?.length ?? 0,
    },
    expected: { ellipses: 0, everyPetalTwice: true, logoPetals: 8, masks: 0 },
  });
});

test('confirmPageStylesheet: the panel is the forest stage with its own ink, and no emerald token is left', () => {
  const css = confirmPageStylesheet();
  const rule = (selector: string) =>
    new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(
      css,
    )?.[1] ?? '';
  assert({
    given: 'the confirm pages stylesheet',
    should:
      'paint the panel with the stage surface and stage ink, its kicker and body with the muted stage ink, and name no emerald token',
    actual: {
      panel: [
        rule('.af-panel').includes('background: var(--af-surface-stage);'),
        rule('.af-panel').includes('color: var(--af-stage-ink);'),
      ],
      muted: [rule('.af-panel-kicker'), rule('.af-panel-body')].map((body) =>
        body.includes('color: var(--af-stage-ink-muted);'),
      ),
      emerald: /emerald/i.test(css),
    },
    expected: { panel: [true, true], muted: [true, true], emerald: false },
  });
});
