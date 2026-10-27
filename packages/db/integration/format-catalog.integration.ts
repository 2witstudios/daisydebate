import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { catalogFormats } from '../src/catalog-formats';
import { rejectedBy, withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const setRole = (
  fixture: Fixture,
  formatId: string,
  role: string | null,
  family: string | null,
) =>
  fixture.sql.unsafe(
    'update formats set catalog_role = $2, family = $3 where id = $1',
    [formatId, role, family],
  );

test('the migrations seed the catalog with a current preset each', async () => {
  await withFixture(url, async (fixture) => {
    const listed = (await fixture.sql.unsafe(
      `select f.id, f.catalog_role as role, f.family, p.version, p.ranked_eligible as ranked
         from formats f
         join format_presets p
           on p.format_id = f.id and p.format_version = f.current_version
          and p.superseded_at is null
        where f.catalog_role is not null
        order by f.sort_order, f.id`,
    )) as Array<Record<string, unknown>>;
    const oneOnOne = (await fixture.sql.unsafe(
      `select bool_and(ranked_eligible) as ranked from format_presets
        where format_id = 'one-on-one' and superseded_at is null`,
    )) as Array<{ ranked: boolean }>;
    assert({
      given: 'a migrated database',
      should:
        'list every catalog format at preset 1, none ranked, and keep the One-on-one preset ranked',
      actual: { listed, oneOnOneRanked: oneOnOne[0]?.ranked },
      expected: {
        listed: catalogFormats.map(({ id, role, family }) => ({
          id,
          role,
          family,
          version: 1,
          ranked: false,
        })),
        oneOnOneRanked: true,
      },
    });
  });
});

test('catalog columns refuse a role the picker cannot honour', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = await fixture.format();
    const owned = await fixture.format();
    const own = (actorId: string | null) =>
      fixture.sql.unsafe(
        'update formats set created_by_actor_id = $2 where id = $1',
        [owned, actorId],
      );
    await own(await fixture.actor());
    try {
      assert({
        given:
          'an unknown role, a standard outside the list, a template without a family, and an actor-owned template',
        should: 'refuse each with its named CHECK',
        actual: [
          await rejectedBy(() => setRole(fixture, formatId, 'featured', null)),
          await rejectedBy(() => setRole(fixture, formatId, 'standard', null)),
          await rejectedBy(() => setRole(fixture, formatId, 'template', null)),
          await rejectedBy(() => setRole(fixture, formatId, null, 'value')),
          await rejectedBy(() => setRole(fixture, owned, 'template', 'value')),
        ],
        expected: [
          'formats_catalog_role_check',
          'formats_standard_ids',
          'formats_family_for_templates',
          'formats_family_for_templates',
          'formats_catalog_is_publisher_owned',
        ],
      });
    } finally {
      // The purge deletes actors before formats.
      await own(null);
    }
  });
});

test('a listed format always keeps a current preset at its current revision', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = await fixture.format();
    try {
      const withoutPreset = await rejectedBy(() =>
        setRole(fixture, formatId, 'template', 'other'),
      );
      await fixture.preset(formatId);
      const withPreset = await rejectedBy(() =>
        setRole(fixture, formatId, 'template', 'other'),
      );
      const supersede = await rejectedBy(() =>
        fixture.sql.unsafe(
          'update format_presets set superseded_at = statement_timestamp() where format_id = $1',
          [formatId],
        ),
      );
      const remove = await rejectedBy(() =>
        fixture.sql.unsafe('delete from format_presets where format_id = $1', [
          formatId,
        ]),
      );
      assert({
        given:
          'listing a format with no preset, listing it with one, then superseding or deleting that preset',
        should:
          'refuse the listing and both removals at commit, and accept the listing with a preset',
        actual: { withoutPreset, withPreset, supersede, remove },
        expected: {
          withoutPreset: 'formats_current_preset_present',
          withPreset: null,
          supersede: 'formats_current_preset_present',
          remove: 'formats_current_preset_present',
        },
      });
    } finally {
      // Unlist first, so the purge may delete the preset.
      await setRole(fixture, formatId, null, null);
    }
  });
});

test('a room basis names a whole preset or none', async () => {
  await withFixture(url, async (fixture) => {
    const host = await fixture.actor();
    const formatId = await fixture.format();
    const basis = (basisFormat: string, version: number | null) =>
      rejectedBy(() =>
        fixture.room(host, basisFormat, {
          basis_format_id: basisFormat,
          basis_preset_version: version,
        }),
      );
    assert({
      given: 'a half basis, a basis naming no preset, and the Value preset',
      should: 'refuse the half and the dangling basis and accept a real preset',
      actual: [
        await basis('value', null),
        await basis(formatId, 1),
        await basis('value', 1),
      ],
      expected: ['rooms_basis_complete', 'rooms_basis_preset_fk', null],
    });
  });
});
