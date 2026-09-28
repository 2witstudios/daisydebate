import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  EXPECTED_SINGLE_H1_PAGE_SHAPE,
  singleH1PageShape,
} from './confirm-page.test-support';
import { renderConfirmPage } from './confirm-page';

setupRitewayBun();

const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
  'base64',
);

const request = (extra: Record<string, string> = {}) =>
  new Request('https://daisy.invalid/auth/confirm', {
    headers: { 'x-nonce': nonce, ...extra },
  });

const token = 'a'.repeat(32);

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
  const html = await renderConfirmPage(
    {
      kind: 'confirm',
      token,
      hidden: { callbackURL: '/lobby' },
      notice: 'Too many attempts. Wait a moment and try again.',
    },
    request(),
  ).text();
  assert({
    given: 'a confirm view with a notice (the retry state)',
    should: 'render the notice inside a role="alert" element',
    actual: /role="alert"[^>]*>.*Too many attempts/s.test(html),
    expected: true,
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
