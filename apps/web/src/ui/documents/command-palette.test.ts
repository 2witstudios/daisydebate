import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoomDocuments } from '../mock/debate-room-docs.test-support';
import { createCommands, paletteCommands } from './command-palette';

setupRitewayBun();

describe('paletteCommands', () => {
  const commands = paletteCommands(sampleRoomDocuments);

  test('new documents', () => {
    assert({
      given: 'the palette',
      should: 'offer one plain new document',
      actual: commands
        .filter((c) => c.choice.kind === 'new')
        .map((c) => [c.title, c.choice]),
      expected: [['New document', { kind: 'new' }]],
    });
  });

  test('existing files', () => {
    assert({
      given: 'the viewer’s documents',
      should: 'offer to open each one by its title',
      actual: commands
        .filter((c) => c.choice.kind === 'open')
        .map((c) => c.title),
      expected: sampleRoomDocuments.map((doc) => doc.title),
    });
  });
});

describe('createCommands', () => {
  test('what the + offers', () => {
    assert({
      given: 'the + palette',
      should: 'offer a document and a folder, and nothing else',
      actual: createCommands.map((command) => [
        command.title,
        command.choice.kind,
      ]),
      expected: [
        ['Document', 'new'],
        ['Folder', 'new-folder'],
      ],
    });
  });
});
