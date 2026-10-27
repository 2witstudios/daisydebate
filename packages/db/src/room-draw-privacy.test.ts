import { getTableColumns } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';
import { createRoomDrawPrivacyAdopter } from './room-draw-privacy';
import {
  resolutionBankEntries,
  resolutionBankRevisions,
  roomResolutionDrawInputs,
  roomResolutionDrawItems,
  roomResolutionDraws,
  roomResolutionStrikes,
  roundDrawPrivateInputs,
  roundDrawSeeds,
  roundResolutionDrawTexts,
} from './schema/resolution-draws';

setupRitewayBun();

const adopter = createRoomDrawPrivacyAdopter({
  closeRoom: (room) => room,
  removeSeat: (room) => room,
  activeRoomMembers: () => [],
});
const names = (columns: Record<string, { name: string }>) =>
  Object.values(columns).map((column) => column.name);

test('draw declarations cover every bank, draw and Round evidence column', () => {
  assert({
    given: 'the resolution bank and draw tables',
    should:
      'declare each column exactly once while the pending basis holds activation',
    actual: validatePrivacyAdoption(
      {
        resolution_bank_revisions: names(
          getTableColumns(resolutionBankRevisions),
        ),
        resolution_bank_entries: names(getTableColumns(resolutionBankEntries)),
        room_resolution_draws: names(getTableColumns(roomResolutionDraws)),
        room_resolution_draw_inputs: names(
          getTableColumns(roomResolutionDrawInputs),
        ),
        room_resolution_draw_items: names(
          getTableColumns(roomResolutionDrawItems),
        ),
        room_resolution_strikes: names(getTableColumns(roomResolutionStrikes)),
        round_draw_seeds: names(getTableColumns(roundDrawSeeds)),
        round_resolution_draw_texts: names(
          getTableColumns(roundResolutionDrawTexts),
        ),
        round_draw_private_inputs: names(
          getTableColumns(roundDrawPrivateInputs),
        ),
      },
      adopter.fields,
    ),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'host-written text, private inputs and the seeds',
    should:
      'classify the text and inputs personal and private and the seeds secret, none exportable',
    actual: adopter.fields
      .filter((f) => f.category === 'personal' || f.category === 'secret')
      .map(({ table, column, category, visibility, exportable }) => [
        `${table}.${column}`,
        category,
        visibility ?? null,
        exportable,
      ]),
    expected: [
      ['room_resolution_draws.seed', 'secret', null, false],
      ['room_resolution_draw_inputs.inputs', 'personal', 'private', false],
      ['room_resolution_draw_items.text', 'personal', 'private', false],
      ['round_draw_seeds.seed', 'secret', null, false],
      ['round_resolution_draw_texts.text', 'personal', 'private', false],
      ['round_draw_private_inputs.inputs', 'personal', 'private', false],
    ],
  });
});
