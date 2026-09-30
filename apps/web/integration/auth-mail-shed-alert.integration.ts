import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { GLOBAL_MINUTE } from './auth-ceiling-helpers';
import { elapse, holdOpen } from './auth-rate-limit-helpers';
import { createTestApp } from './fixtures';
import { serveEdge } from './ops-edge';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * ISSUE-220: a flood that fills the handed-off work's bound sheds sign-in
 * mail with everything else (DEC-73). That must reach an operator: the
 * composed app's logger tap counts every `auth.mail.shed`, and
 * `/api/ops/alerts` (what the AUTH-7.7 probe reads) fires `mail_shed` once
 * the count over its window reaches the documented threshold.
 */
requireTestServices(process.env);
setupRitewayBun();

const opsToken = `ops-${createId()}${createId()}`;
const testApp = createTestApp({ OPS_PROBE_TOKEN: opsToken });
const { app, routes, mailbox, freshEmail, jsonPost, newClient } = testApp;

const magicLink = (email: string) =>
  routes.auth.POST(
    jsonPost(
      '/api/auth/sign-in/magic-link',
      { email },
      { [CLIENT_IP_HEADER]: newClient() },
    ),
  );

/** A slow provider: every handed-off task holds its slot about a second. */
const PROVIDER_ROUND_TRIP_MS = 1_000;

describe('ISSUE-220 shedding past the bound raises an operator alert', () => {
  test('a flood that sheds handed-off work fires mail_shed on /api/ops/alerts, with counts only', async () => {
    const edge = await serveEdge({ app, routes, opsToken });
    try {
      const before = await edge.alerts();
      mailbox.setLatency(PROVIDER_ROUND_TRIP_MS);
      // 120 new addresses with room: each is really sent, so the app
      // measures the slow provider, and the minute ceiling saturates.
      await elapse(testApp, GLOBAL_MINUTE);
      await Promise.all(
        Array.from({ length: 120 }, () => magicLink(freshEmail())),
      );
      await holdOpen(testApp, GLOBAL_MINUTE, 600_000);
      const { events } = await testApp.withLoggedEvents(() =>
        Promise.all(Array.from({ length: 200 }, () => magicLink(freshEmail()))),
      );
      const shed = events.filter((event) => event === 'auth.mail.shed').length;
      const after = await edge.alerts();
      await app.auth().settled();
      mailbox.setLatency(0);
      assert({
        given: `the real minute ceiling saturated, a provider taking ${PROVIDER_ROUND_TRIP_MS} ms, then 200 new addresses at once (${shed} shed)`,
        should:
          'fire mail_shed on /api/ops/alerts, where nothing fired for it before, with the shed count in the snapshot and no address in the condition',
        actual: {
          firedBefore: before.conditions?.includes('mail_shed'),
          firedAfter: after.conditions?.includes('mail_shed'),
          counted: after.snapshot?.mailShed?.count === shed,
          condition: JSON.stringify(after).includes('@')
            ? 'has an address'
            : 'counts only',
        },
        expected: {
          firedBefore: false,
          firedAfter: true,
          counted: true,
          condition: 'counts only',
        },
      });
    } finally {
      await edge.close();
    }
  }, 300_000);
});
