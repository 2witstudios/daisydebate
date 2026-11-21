import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('only Freestyle is creatable ranked: generic One-on-one and a league template refuse', async () => {
  await withRoomRuntime(async (f) => {
    const seasonId = createId();
    try {
      await withSeasons(databaseUrl, (s) =>
        s.activateBetaSeason({ id: seasonId, division: 'open' }),
      );
      const [current] =
        await f.sql`select f.current_version as "formatVersion", p.version as "presetVersion" from formats f join format_presets p on p.format_id=f.id and p.format_version=f.current_version and p.superseded_at is null where f.id='one-on-one'`;
      await assertRejects({
        given: 'an active season and the retired generic ranked format',
        should: 'refuse generic ranked construction',
        actual: () =>
          f.create({
            selection: { kind: 'ranked', formatId: 'one-on-one', ...current },
          }),
        code: 'VALIDATION',
      });
      const catalog = (await f.operations.catalog(f.host)).choices;
      const template = catalog.find((c) => c.formatId === 'nsda-ld')!;
      await assertRejects({
        given: 'an active season and a league template asked for ranked',
        should: 'refuse it: a template is a casual starting point',
        actual: () =>
          f.create({
            selection: {
              kind: 'ranked',
              formatId: template.formatId,
              formatVersion: template.formatVersion,
              presetVersion: template.preset.version,
            },
          }),
        code: 'VALIDATION',
      });
      const freestyle = catalog.find((c) => c.formatId === 'freestyle')!;
      const view = (
        await f.create({
          selection: {
            kind: 'ranked',
            formatId: freestyle.formatId,
            formatVersion: freestyle.formatVersion,
            presetVersion: freestyle.preset.version,
          },
        })
      ).view;
      assert({
        given: 'the current canonical Freestyle preset after the refusals',
        should: 'create one ranked Room without a generic compatibility pool',
        actual: [
          view.competitionType,
          view.formatId,
          view.format.basis,
          catalog.some((c) => c.formatId === 'one-on-one'),
        ],
        expected: ['ranked', 'freestyle', null, false],
      });
    } finally {
      f.afterRooms(async () => {
        await f.sql`delete from seasons where id=${seasonId}`;
      });
    }
  });
});

test('a ranked Room is refused on each casual template: only one seat a side, one judge and a winner rank (TAB-6.14)', async () => {
  await withRoomRuntime(async (f) => {
    const seasonId = createId();
    try {
      await withSeasons(databaseUrl, (s) =>
        s.activateBetaSeason({ id: seasonId, division: 'open' }),
      );
      const templates = [
        'panel-debate',
        'four-team',
        'speech-section',
        'open-conversation',
      ];
      const refusals = await Promise.all(
        templates.map((formatId) =>
          f
            .create({
              selection: {
                kind: 'ranked',
                formatId,
                formatVersion: 1,
                presetVersion: 1,
              },
            })
            .then(
              () => 'created',
              (error: { readonly code?: string }) => error.code,
            ),
        ),
      );
      const [rooms] =
        await f.sql`select count(*)::int as n from rooms where format_id in ${f.sql(templates)}`;
      assert({
        given:
          'an active season and a ranked create on the three-judge, four-team, speech-section and open-conversation templates',
        should: 'refuse every one and create no Room',
        actual: { refusals, rooms: rooms.n },
        expected: { refusals: Array(4).fill('VALIDATION'), rooms: 0 },
      });
    } finally {
      f.afterRooms(async () => {
        await f.sql`delete from seasons where id=${seasonId}`;
      });
    }
  });
});
