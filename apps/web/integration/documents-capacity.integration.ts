import { createId } from '@paralleldrive/cuid2';
import { fixedClock, systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentOperations } from '../src/features/documents/document-operations';
import { testDatabaseUrl, withSql } from './fixtures';

setupRitewayBun();
requireTestServices(process.env);

/** Past the lane's 3 running and 64 queued, so the burst really overflows it. */
const SEATS = 100;
const BODY = `<p>${'carbon tax enforcement evidence '.repeat(6_000)}</p>`;

const percentile = (values: readonly number[], share: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * share)] ?? 0;

/**
 * ADR 0111's capacity proof, on one web process's profile: a burst of saves and
 * searches of near-limit documents fills the documents and search lanes, while a
 * read on the competitive lane keeps being admitted. The numbers are printed for
 * the PR; the assertions hold only what the lanes promise.
 */
test('a full documents lane takes nothing from the competitive lane', async () => {
  const userId = createId();
  const actorId = createId();
  await withSql(async (sql) => {
    await sql`insert into users (id, username, email_verified) values (${userId}, ${userId}, true)`;
    await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    await sql`insert into account_age (user_id, birth_month, version, recorded_at)
      values (${userId}, '1990-01', 1, now())`;
    await sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance)
      values (${userId}, 'approved', now(), now(), 'signup')`;
    await sql`insert into documents (id, owner_actor_id, title, html)
      select md5(i::text || ${actorId}), ${actorId}, 'Doc ' || i, ${BODY}
      from generate_series(1, ${SEATS}) as i`;
  });
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  const operations = createDocumentOperations({
    store: database,
    clock: fixedClock('2026-10-05T18:00:00.000Z'),
    ids: systemId,
  });
  const me = { userId, actorId };
  try {
    const ids = (await withSql(
      (sql) => sql`select id from documents where owner_actor_id = ${actorId}`,
    )) as { id: string }[];
    const tally = {
      saved: 0,
      savesRefused: 0,
      searched: 0,
      searchesRefused: 0,
      competitive: 0,
      competitiveRefused: 0,
    };
    const saveMs: number[] = [];
    const searchMs: number[] = [];
    const competitiveMs: number[] = [];
    let running = true;
    const competitive = (async () => {
      while (running) {
        const started = performance.now();
        await database.getRound(createId()).then(
          () => {
            tally.competitive += 1;
          },
          () => {
            tally.competitiveRefused += 1;
          },
        );
        competitiveMs.push(performance.now() - started);
      }
    })();
    const alone = async (work: () => Promise<unknown>) => {
      const at = performance.now();
      await work();
      return Math.round(performance.now() - at);
    };
    const quiet = {
      saveMs: await alone(() =>
        operations.saveDocument(me, {
          id: ids[0]!.id,
          html: BODY,
          expectedRevision: 1,
        }),
      ),
      searchEveryDocumentMs: await alone(() =>
        operations.search(me, { text: 'carb', page: 0 }),
      ),
      searchOneDocumentMs: await alone(() =>
        operations.search(me, { text: 'nowhere', page: 0 }),
      ),
    };
    const started = performance.now();
    await Promise.all([
      ...ids.slice(1).map(async ({ id }, i) => {
        const at = performance.now();
        await operations
          .saveDocument(me, {
            id,
            html: `<p>edit ${i} ${'carbon tax '.repeat(16_000)}</p>`,
            expectedRevision: 1,
          })
          .then(
            () => {
              tally.saved += 1;
              saveMs.push(performance.now() - at);
            },
            () => {
              tally.savesRefused += 1;
            },
          );
      }),
      ...Array.from({ length: 50 }, async () => {
        const at = performance.now();
        await operations.search(me, { text: 'carb', page: 0 }).then(
          () => {
            tally.searched += 1;
            searchMs.push(performance.now() - at);
          },
          () => {
            tally.searchesRefused += 1;
          },
        );
      }),
    ]);
    const elapsed = performance.now() - started;
    running = false;
    await competitive;
    // The PR quotes this line (ADR 0111).
    process.stdout.write(
      `${JSON.stringify({
        quiet,
        elapsedMs: Math.round(elapsed),
        ...tally,
        saveP50: Math.round(percentile(saveMs, 0.5)),
        saveP95: Math.round(percentile(saveMs, 0.95)),
        searchP50: Math.round(percentile(searchMs, 0.5)),
        searchP95: Math.round(percentile(searchMs, 0.95)),
        competitiveP95: Math.round(percentile(competitiveMs, 0.95)),
      })}\n`,
    );
    assert({
      given: 'the documents and search lanes under a burst past their budgets',
      should: 'refuse no read on the competitive lane',
      actual: tally.competitiveRefused,
      expected: 0,
    });
  } finally {
    await database.close();
    await withSql(async (sql) => {
      await sql`delete from documents where owner_actor_id = ${actorId}`;
      await sql`delete from account_beta_access where user_id = ${userId}`;
      await sql`delete from account_age where user_id = ${userId}`;
      await sql`delete from actors where id = ${actorId}`;
      await sql`delete from users where id = ${userId}`;
    });
  }
  // Seeding near-limit documents is slow on a loaded runner. A test that timed out
  // would keep its burst running into the next suite, on connections still open.
}, 120_000);
