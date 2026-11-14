import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { insertRow, loadSampleTournament } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

// Two sessions must both see committed rows, and the tab record cannot be
// deleted afterwards, so this suite commits into a database of its own.
const scratch = scratchDatabase(url, 'drawrace');
afterAll(() => scratch.drop());

/** TAB-4.10, under concurrency. */
test(
  'a fixture added while its draw is being published waits for the publish and is refused',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const publisher = new SQL(scratch.url, { max: 1 });
    const writer = new SQL(scratch.url, { max: 1 });
    try {
      await publisher.unsafe('begin');
      const ids = await loadSampleTournament(publisher);
      const round2 = {
        lobby_id: ids.lobby,
        event_id: ids.debate,
        tab_round_id: ids.round2,
      };
      const late = createId();
      await insertRow(publisher, 'fixtures', {
        id: late,
        ...round2,
        kind: 'bye',
      });
      await publisher.unsafe('commit');

      await publisher.unsafe('begin');
      await publisher.unsafe(
        `update draws set status = 'published', published_at = now() where id = $1`,
        [ids.draw2],
      );
      // The second session writes before the publish commits.
      const racing = insertRow(writer, 'draw_fixtures', {
        draw_id: ids.draw2,
        fixture_id: late,
        ...round2,
      }).then(
        () => 'accepted',
        (error: { constraint?: string; errno?: string }) =>
          error.constraint ?? error.errno ?? 'failed',
      );
      const waited = await Promise.race([
        racing.then(() => 'settled before the publish committed'),
        Bun.sleep(300).then(() => 'waited'),
      ]);
      await publisher.unsafe('commit');
      assert({
        given:
          'a draw being published in one session and a fixture added to it in another before the publish commits',
        should:
          'make the second session wait for the publish, then refuse its write',
        actual: {
          waited,
          outcome: await racing,
          held: (
            await publisher.unsafe(
              'select count(*)::int as rows from draw_fixtures where draw_id = $1',
              [ids.draw2],
            )
          )[0],
        },
        expected: {
          waited: 'waited',
          outcome: 'draw_fixtures_published_immutable',
          held: { rows: 0 },
        },
      });
    } finally {
      await publisher.close();
      await writer.close();
    }
  },
  ddlTimeoutMs,
);
