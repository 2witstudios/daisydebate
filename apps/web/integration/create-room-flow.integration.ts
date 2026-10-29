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

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
async function createPublishedValueRoom(f: Fixture) {
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
  return { publication, created };
}

test('published creation pins authoritative text; metadata preserves the standard and custom text leaves it', async () => {
  await withRoomRuntime(async (f) => {
    const { publication, created } = await createPublishedValueRoom(f);
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

test('publication replacement cannot alter existing Room or frozen Round wording and provenance', async () => {
  await withRoomRuntime(async (f) => {
    const { publication, created } = await createPublishedValueRoom(f);
    let room = created.view;
    const judge = await f.member();
    const seats = [
      { caller: f.host, role: 'affirmative' },
      { caller: f.guest, role: 'negative' },
      { caller: judge, role: 'judge' },
    ] as const;
    for (const seat of seats)
      room = (
        await f.command(seat.caller, room, {
          type: 'claim-seat',
          role: seat.role,
          slot: 0,
        })
      ).view;
    for (const seat of seats)
      room = (
        await f.consent(
          seat.caller,
          await f.operations.view(seat.caller, room.id),
          'ready',
        )
      ).view;
    room = (await f.command(f.host, room, { type: 'start-round' })).view;
    let pins: unknown;
    const rollback = new Error('Rollback publication replacement proof');
    try {
      await f.sql.begin(async (transaction) => {
        await transaction`update published_resolutions set retired_at=clock_timestamp() where id=${publication.id}`;
        await transaction`insert into published_resolutions(id,kind,text,provenance,edition,theme) values (${createId()},'value','Replacement wording','Test replacement','Test edition','Test theme')`;
        const [row] =
          await transaction`select rm.topic,rm.published_resolution_id as room_pin,rd.resolution,rd.published_resolution_id as round_pin,p.provenance,p.edition,p.theme from rooms rm join rounds rd on rd.room_id=rm.id join published_resolutions p on p.id=rd.published_resolution_id where rm.id=${room.id}`;
        pins = row;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert({
      given:
        'a Room and scheduled Round pinned before a publication replacement',
      should:
        'retain their exact wording, IDs and owner provenance independently of current publication',
      actual: pins,
      expected: {
        topic: publication.text,
        room_pin: publication.id,
        resolution: publication.text,
        round_pin: publication.id,
        provenance: 'Owner-confirmed Daisy Beta Season 1 (2026-10-29)',
        edition: 'Beta Season 1',
        theme: 'Culture and social priorities',
      },
    });
  });
});
