import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCreateSchema } from '@daisy/protocol';
import { createRoomDraft } from '../src/features/rooms/create-room-draft';
import { draftFormValues } from '../src/features/rooms/create-room-fields';
import { prepareRoomDraft } from '../src/features/rooms/prepare-room-draft';
import { createAssembly } from '../src/features/rooms/create-assembly';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('published creation pins authoritative text; metadata preserves the standard and custom text leaves it', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const choice = catalog.choices.find((entry) => entry.formatId === 'value')!;
    const publication = catalog.resolutions.find(
      (entry) => entry.kind === 'value',
    )!;
    const created = await f.create({
      resolution: { kind: 'value', id: publication.id },
      selection: {
        kind: 'catalog',
        formatId: choice.formatId,
        formatVersion: choice.formatVersion,
        presetVersion: choice.preset.version,
        competitionType: 'casual',
      },
    });
    const renamed = (
      await f.command(f.host, created.view, {
        type: 'update-details',
        title: 'A social room',
        visibility: 'unlisted',
        topic: publication.text,
      })
    ).view;
    const [pinned] =
      await f.sql`select published_resolution_id from rooms where id=${renamed.id}`;
    const custom = (
      await f.command(f.host, renamed, {
        type: 'update-details',
        title: renamed.title,
        visibility: renamed.visibility,
        topic: 'Cities should make public transit free.',
      })
    ).view;
    const [changed] =
      await f.sql`select published_resolution_id from rooms where id=${custom.id}`;
    assert({
      given: 'a standard room, a metadata edit and then a custom resolution',
      should:
        'pin published wording, preserve the standard for metadata and clear the publication reference for Custom',
      actual: [
        created.view.topic,
        pinned?.published_resolution_id,
        renamed.format.standing.kind,
        custom.format.standing.kind,
        custom.format.basis?.formatId,
        changed?.published_resolution_id,
      ],
      expected: [
        publication.text,
        publication.id,
        'standard',
        'custom',
        'value',
        null,
      ],
    });
  });
});

test('the native Custom editor persists exact settings, POI and its template basis through canonical creation', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const choice = catalog.choices.find((entry) => entry.formatId === 'value')!;
    const form = new FormData();
    Object.entries(draftFormValues(createRoomDraft(choice))).forEach(
      ([key, value]) => form.set(key, value),
    );
    form.set('commandId', createId());
    form.set('title', 'POI practice');
    form.set('visibility', 'unlisted');
    form.set('questionStyle', 'poi');
    form.set('resolutionMethod', 'custom');
    form.set('customResolution', 'Cities should make public transit free.');
    form.set('duration.segment.0', '4:32.123');
    form.set('ranked', 'on');
    const prepared = prepareRoomDraft(
      form,
      catalog.choices,
      catalog.resolutions,
    );
    if (prepared.kind !== 'submit')
      throw new Error('Custom draft must compile');
    const result = await createAssembly(
      async (_path, request) =>
        Response.json(
          await f.create(
            roomCreateSchema.parse(JSON.parse(String(request.body))),
          ),
        ),
      prepared.form,
    );
    if (result.kind !== 'created')
      throw new Error('Canonical Custom creation must succeed');
    const view = await f.operations.view(f.host, result.roomId);
    assert({
      given: 'native edited timing, POI and a checked Ranked field',
      should:
        'persist the exact timing and open speaking policy as unranked Custom based on Value',
      actual: [
        view.competitionType,
        view.format.standing.kind,
        view.format.basis?.formatId,
        view.rules.segments[0]?.durationMs,
        view.rules.interaction.interruptions?.allowed,
      ],
      expected: ['casual', 'custom', 'value', 272_123, 'open'],
    });
  });
});
