import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validConfig } from './round-fixtures';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261029202017_silent_thor_girl';
const scratch = scratchDatabase(databaseUrl, 'seasonpubit');
afterAll(() => scratch.drop());

test(
  'Season 1 publication migration preserves populated Room and Round pins',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const publicationId = createId();
      const wording = 'Seeded previous publication.';
      await f.sql`update published_resolutions set retired_at=clock_timestamp() where kind='policy' and retired_at is null`;
      await f.sql`insert into published_resolutions(id,kind,text,provenance) values (${publicationId},'policy',${wording},'Seeded predecessor provenance')`;
      const actor = await f.actor();
      const format = await f.format();
      const roomId = await f.room(actor, format, {
        topic: wording,
        published_resolution_id: publicationId,
      });
      const roundId = await f.round({
        room_id: roomId,
        room_config_snapshot: validConfig,
        visibility: 'public',
        created_by_actor_id: actor,
        format_id: format,
        resolution: wording,
        published_resolution_id: publicationId,
      });
      await scratch.migrate((folder) => folder <= migration);
      await scratch.migrate((folder) => folder <= migration);
      const [pins] =
        await f.sql`select rm.topic,rm.published_resolution_id as room_pin,rd.resolution,rd.published_resolution_id as round_pin,p.text,p.provenance,p.retired_at is not null as retired from rooms rm join rounds rd on rd.room_id=rm.id join published_resolutions p on p.id=rd.published_resolution_id where rm.id=${roomId} and rd.id=${roundId}`;
      const current =
        await f.sql`select kind,text,edition,theme,provenance from published_resolutions where retired_at is null order by kind`;
      assert({
        given:
          'a predecessor database with a current publication and Room/Round references, then the forward migration twice',
        should:
          'retire the old record, preserve every pinned value, and publish exactly the confirmed Season 1 pair once',
        actual: { pins, current: [...current] },
        expected: {
          pins: {
            topic: wording,
            room_pin: publicationId,
            resolution: wording,
            round_pin: publicationId,
            text: wording,
            provenance: 'Seeded predecessor provenance',
            retired: true,
          },
          current: [
            {
              kind: 'policy',
              text: 'Resolved: Competitive debate should be a mandatory component of the core curriculum in American public education.',
              edition: 'Beta Season 1',
              theme: 'Education and institutional adoption',
              provenance: 'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
            },
            {
              kind: 'value',
              text: 'Resolved: The world would be a better place if traditional sports were replaced by competitive debate.',
              edition: 'Beta Season 1',
              theme: 'Culture and social priorities',
              provenance: 'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
            },
          ],
        },
      });
    });
  },
  ddlTimeoutMs,
);
