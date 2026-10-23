import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { redactText, sanitizeArtifactTree } from './e2e-artifact-sanitizer';

setupRitewayBun();

// The framings below are copied from a real Playwright trace of the sign-in
// journey (ISSUE-487); only the token value is replaced by a fake.
/** An emailed-link token's shape: 32 bytes of base64url, 43 characters. */
const shaped = 'Q7vXk2mN9pR4sT6wY8zA1bC3dE5fG7hJ9kL2mN4pQ6r';
/** A value the shape rule cannot see, so only the field names can redact it. */
const unshaped = 'not-token-shaped-but-a-secret';
const records = (token: string) => ({
  confirmPage: `<form class="af-form" method="post" action="/auth/confirm"><input type="hidden" name="token" value="${token}"><input type="hidden" name="callbackURL" value="/lobby">`,
  domSnapshot: JSON.stringify({
    type: 'frame-snapshot',
    snapshot: {
      html: [
        'FORM',
        { method: 'post', action: '/auth/confirm' },
        [
          'INPUT',
          {
            __playwright_value_: token,
            type: 'hidden',
            name: 'token',
            value: token,
          },
        ],
      ],
    },
  }),
  formParams: JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      request: {
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          text: '',
          params: [
            { name: 'token', value: token },
            { name: 'callbackURL', value: '/lobby' },
          ],
        },
      },
    },
  }),
  jsonBody: JSON.stringify({ token, callbackURL: '/lobby' }),
});

test('a magic-link token is redacted from every real trace framing (ISSUE-487)', () => {
  for (const token of [shaped, unshaped]) {
    const leaked = Object.entries(records(token))
      .filter(([, text]) => redactText(text).includes(token))
      .map(([name]) => name);
    assert({
      given: `the confirm page, DOM snapshot, form params and JSON body holding ${token === shaped ? 'a token-shaped' : 'an unshaped'} value`,
      should: 'leave the value in none of them',
      actual: leaked,
      expected: [],
    });
  }
});

test('a served confirm page saved as an artifact keeps no token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daisy-e2e-tokens-'));
  try {
    const page = join(root, 'confirm.html');
    writeFileSync(page, records(shaped).confirmPage);
    sanitizeArtifactTree(root);
    const after = await Bun.file(page).text();
    assert({
      given: 'a confirm page resource written by the trace recorder',
      should: 'redact its hidden token input in place',
      actual: [after.includes(shaped), after.includes('name="token"')],
      expected: [false, true],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
