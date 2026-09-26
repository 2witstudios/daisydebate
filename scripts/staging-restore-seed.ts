/**
 * `bun scripts/staging-restore-seed.ts`: AUTH-7.6's synthetic staging
 * content. Staging held no rows at all when the restore rehearsal needed
 * one (`bun doctor` and a direct row count both confirmed it), so this
 * script creates a representative slice through the same `applyDevSeed`
 * adapter operation `bun db:seed` uses, plus the auth rows `applyDevSeed`
 * does not cover (sessions, verification tokens, passkeys) by direct
 * insert. Every value is synthetic: fixed cuid2-shaped ids, `@example.test`
 * addresses (RFC 2606, never delivered) and placeholder WebAuthn material —
 * never real personal data, and never anyone's real inbox. Idempotent, like
 * `applyDevSeed`: rerunning leaves every row unchanged (`ON CONFLICT DO
 * NOTHING`/`DO UPDATE` throughout).
 *
 * Only ever point this at an isolated database: staging's own
 * `daisy_debate_staging` for the rehearsal's synthetic source rows, never
 * production.
 */
import { SQL } from 'bun';
import { applyDevSeed } from '@daisy/db/dev-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const restoreSeedVersion = 'restore-rehearsal-seed-v1';

const people = [
  {
    userId: 'r1s2t3u4v5w6x7y8z9a0b1c2',
    actorId: 'd3e4f5g6h7i8j9k0l1m2n3o4',
    username: 'restore-rehearsal-a',
    email: 'restore-rehearsal-a@example.test',
    emailVerified: true,
  },
  {
    userId: 'p5q6r7s8t9u0v1w2x3y4z5a6',
    actorId: 'b7c8d9e0f1g2h3i4j5k6l7m8',
    username: 'restore-rehearsal-b',
    email: 'restore-rehearsal-b@example.test',
    emailVerified: true,
  },
] as const;

const debateId = 'n9o0p1q2r3s4t5u6v7w8x9y0';
const resolution =
  'Resolved: AUTH-7.6 needs a representative debate to prove a restore.';
const createdAt = '2026-01-01T00:00:00.000Z';

await applyDevSeed({
  url,
  seed: {
    name: 'restore-rehearsal',
    version: restoreSeedVersion,
    people: [...people],
    debate: {
      id: debateId,
      createdBy: people[0].actorId,
      resolution,
      format: 'foundation',
      mode: 'practice',
      visibility: 'private',
      snapshot: {
        version: 1,
        id: debateId,
        resolution,
        format: 'foundation',
        rules: {
          version: 1,
          seats: { affirmative: 1, negative: 1, judge: 0 },
          clock: { speechMs: 240_000, prepMs: 120_000 },
        },
        phase: 'waiting',
        createdAt,
        participants: [
          { id: people[0].actorId, side: 'affirmative', ready: false },
          { id: people[1].actorId, side: 'negative', ready: false },
        ],
      },
    },
  },
});

// Sessions, verification tokens and passkeys: not part of applyDevSeed's
// adapter operation, so inserted directly. Placeholder WebAuthn material
// only ever needs to satisfy the schema, never a real ceremony.
const client = new SQL(url, { max: 1 });
try {
  for (const [index, person] of people.entries()) {
    await client`
      insert into session (id, expires_at, token, ip_address, user_agent, user_id)
      values (
        ${`restore-seed-session-${index}`},
        now() + interval '30 days',
        ${`restore-seed-session-token-${index}`},
        '198.18.0.1',
        'restore-rehearsal-seed',
        ${person.userId}
      )
      on conflict (id) do update set
        expires_at = excluded.expires_at,
        token = excluded.token,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent
    `;
    await client`
      insert into passkey (
        id, name, public_key, user_id, credential_id, counter,
        device_type, backed_up, transports, aaguid
      )
      values (
        ${`restore-seed-passkey-${index}`},
        'Restore rehearsal synthetic passkey',
        'restore-rehearsal-placeholder-public-key',
        ${person.userId},
        ${`restore-seed-credential-${index}`},
        0,
        'singleDevice',
        false,
        'internal',
        null
      )
      on conflict (id) do update set
        public_key = excluded.public_key,
        credential_id = excluded.credential_id
    `;
  }
  await client`
    insert into verification (id, identifier, value, expires_at)
    values (
      'restore-seed-verification-0',
      ${`sign-in:${people[0].email}`},
      'restore-rehearsal-placeholder-token',
      now() + interval '5 minutes'
    )
    on conflict (id) do update set
      identifier = excluded.identifier,
      value = excluded.value,
      expires_at = excluded.expires_at
  `;
} finally {
  await client.close();
}

process.stdout.write(`Restore rehearsal seed version: ${restoreSeedVersion}\n`);
