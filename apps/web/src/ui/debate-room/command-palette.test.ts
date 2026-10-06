import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { documentTemplates } from '../../features/debate-room/documents';
import { sampleRoomDocuments } from '../mock/debate-room-docs';
import { paletteCommands } from './command-palette';

setupRitewayBun();

describe('paletteCommands', () => {
  const commands = paletteCommands(sampleRoomDocuments);

  test('new documents', () => {
    assert({
      given: 'the document templates',
      should: 'offer each one in this round and in the library',
      actual: commands.filter((c) => c.choice.kind === 'new').length,
      expected: documentTemplates.length * 2,
    });
  });

  test('existing files', () => {
    assert({
      given: 'the round’s documents',
      should: 'offer to open each one by its title',
      actual: commands
        .filter((c) => c.choice.kind === 'open')
        .map((c) => c.title),
      expected: sampleRoomDocuments.map((doc) => doc.title),
    });
  });

  test('a new flow in this round', () => {
    assert({
      given: 'the flow template in the round folder',
      should: 'choose a new flow there',
      actual: commands.find((c) => c.id === 'new:round:flow')?.choice,
      expected: { kind: 'new', templateId: 'flow', folder: 'round' },
    });
  });
});
