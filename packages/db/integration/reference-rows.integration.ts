import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  referenceAiJudge,
  referenceBots,
  referencePresets,
} from '../src/reference-formats';
import { resolutionBankRevision1 } from '../src/resolution-bank';
import {
  canonicalPresets,
  seededFormats,
  seededPresets,
} from '../src/migrations.test-support';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/**
 * The reference rows the committed migrations write, read from a database
 * they alone built: the TypeScript reference data must say the same.
 */
const scratch = scratchDatabase(databaseUrl, 'referencerows');
afterAll(() => scratch.drop());
const rows = (async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const client = new SQL(scratch.url, { max: 1 });
  try {
    return {
      formats: (await client`
        select id, name, current_version as "currentVersion" from formats order by id`) as {
        id: string;
        name: string;
        currentVersion: number;
      }[],
      revisions: (await client`
        select format_id || '@' || version as key, definition from format_revisions
        order by format_id, version`) as { key: string; definition: unknown }[],
      presets: (await client`
        select format_id as "formatId", version, format_version as "formatVersion",
          config, superseded_at is not null as superseded
        from format_presets order by format_id, version`) as {
        formatId: string;
        version: number;
        formatVersion: number;
        config: unknown;
        superseded: boolean;
      }[],
      bots: (await client`
        select actor_id as "actorId", name, persona, voice, difficulty
        from bot_profiles order by actor_id`) as unknown[],
      judges: (await client`
        select actor_id as "actorId", name from ai_judge_profiles order by actor_id`) as unknown[],
      bank: (await client`
        select id, text, category, difficulty, locale, provenance,
          added_in_revision as revision
        from resolution_bank_entries order by id`) as unknown[],
    };
  } finally {
    await client.close();
  }
})();

/** The newest approved revision per format: the one ranked play resolves. */
const currentReferencePresets = () =>
  referencePresets.filter(
    (preset) =>
      !referencePresets.some(
        (later) =>
          later.formatId === preset.formatId && later.version > preset.version,
      ),
  );

const byId = <T extends { readonly id: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

test(
  'formats and every definition revision mirror exactly the rows the migrations write',
  async () => {
    const { formats, revisions } = await rows;
    assert({
      given:
        'the TypeScript reference and catalog formats and a database the migrations built',
      should:
        'name the same formats, every immutable revision and the current pointer',
      actual: {
        formats,
        definitions: Object.fromEntries(
          revisions.map(({ key, definition }) => [key, definition]),
        ),
      },
      expected: {
        formats: byId(
          seededFormats.map(({ id, name, revisions: list }) => ({
            id,
            name,
            currentVersion: list.length,
          })),
        ),
        definitions: Object.fromEntries(
          seededFormats.flatMap(({ id, revisions: list }) =>
            list.map((definition, index) => [`${id}@${index + 1}`, definition]),
          ),
        ),
      },
    });
  },
  ddlTimeoutMs,
);

test(
  'presets mirror every sanctioned configuration the migrations approve',
  async () => {
    const { presets } = await rows;
    assert({
      given:
        'the TypeScript reference presets and a database the migrations built',
      should:
        'approve the same revisions, superseding all but the newest per format',
      actual: {
        approved: canonicalPresets(presets),
        current: canonicalPresets(
          presets.filter(({ superseded }) => !superseded),
        ),
      },
      expected: {
        approved: canonicalPresets(seededPresets),
        current: canonicalPresets([
          ...currentReferencePresets(),
          ...seededPresets.slice(referencePresets.length),
        ]),
      },
    });
  },
  ddlTimeoutMs,
);

test(
  'bots and the AI judge ship as the baseline says',
  async () => {
    const { bots, judges } = await rows;
    assert({
      given: 'the bot roster, the AI judge and a database the migrations built',
      should:
        'seat the same bot debaters with the same profiles, and the AI judge only in its own table',
      actual: { bots, judges },
      expected: {
        bots: [...referenceBots]
          .sort((a, b) => (a.actorId < b.actorId ? -1 : 1))
          .map(({ actorId, name, persona, voice, difficulty }) => ({
            actorId,
            name,
            persona,
            voice,
            difficulty,
          })),
        judges: [referenceAiJudge],
      },
    });
  },
  ddlTimeoutMs,
);

test(
  'the migrations seed exactly revision 1 of the curated bank',
  async () => {
    const { bank } = await rows;
    assert({
      given: 'the TypeScript bank and a database the migrations built',
      should: 'hold the same entries at revision 1',
      actual: bank,
      expected: byId(
        resolutionBankRevision1.entries.map((entry) => ({
          ...entry,
          revision: resolutionBankRevision1.revision,
        })),
      ),
    });
  },
  ddlTimeoutMs,
);
