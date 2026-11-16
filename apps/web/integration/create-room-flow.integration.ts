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

test('a Freestyle Room keeps its standard through a metadata edit and refuses host-written text', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const choice = catalog.choices.find(
      (entry) => entry.formatId === 'freestyle',
    )!;
    const created = await f.create({
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
      })
    ).view;
    const before = await f.snapshot(renamed.id);
    const refusal = await f
      .command(f.host, renamed, {
        type: 'update-details',
        title: renamed.title,
        visibility: renamed.visibility,
        topic: 'Cities should make public transit free.',
      })
      .catch((error: { reason?: string }) => error.reason);
    assert({
      given:
        'a casual Freestyle Room, a metadata edit, then host-written resolution text',
      should:
        'strike from the bank, stay Standard through the metadata edit and refuse the text leaving the Room unchanged',
      actual: [
        created.view.topic,
        renamed.format.standing,
        refusal,
        await f.snapshot(renamed.id),
      ],
      expected: [
        null,
        { kind: 'standard', formatId: 'freestyle' },
        'illegal-config',
        before,
      ],
    });
  });
});

test('the native Custom editor persists exact settings, POI and its template basis through canonical creation', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const choice = catalog.choices.find((entry) => entry.formatId === 'nsda-ld')!;
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
    const prepared = prepareRoomDraft(form, catalog.choices);
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
        'persist the exact timing and open speaking policy as unranked Custom based on NSDA Lincoln-Douglas',
      actual: [
        view.competitionType,
        view.format.standing.kind,
        view.format.basis?.formatId,
        view.rules.segments[0]?.durationMs,
        view.rules.interaction.interruptions?.allowed,
      ],
      expected: ['casual', 'custom', 'nsda-ld', 272_123, 'open'],
    });
  });
});
