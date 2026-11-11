import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readRoomDraftAnswer,
  exportRoomDraftAnswer,
  eraseRoomDraftAnswer,
  saveRoomDraftAnswer,
} from './create-room-draft-answer';
import { idle } from '../forms/form-state';
setupRitewayBun();

test('native preview answers are bounded and principal scoped', async () => {
  const data = new Map<string, string>();
  const expiries: number[] = [];
  const store = {
    setEphemeral: async (key: string, value: string, ttl: number) => {
      data.set(key, value);
      expiries.push(ttl);
    },
    get: async (key: string) => data.get(key) ?? null,
    delete: async (key: string) => {
      data.delete(key);
    },
  };
  const member = 'm'.repeat(24),
    command = 'c'.repeat(24),
    other = 'o'.repeat(24);
  const state = idle({
    title: 'Kept room',
    'duration.segment.0': '4:32.123',
  });
  await saveRoomDraftAnswer(store, member, command, null, state);
  const found = await readRoomDraftAnswer(store, member, command, null);
  const wrongMember = await readRoomDraftAnswer(store, other, command, null);
  const wrongCommand = await readRoomDraftAnswer(store, member, other, null);
  const wrongSource = await readRoomDraftAnswer(store, member, command, other);
  const exported = await exportRoomDraftAnswer(store, member);
  const otherExport = await exportRoomDraftAnswer(store, other);
  await saveRoomDraftAnswer(store, member, other, null, {
    kind: 'invalid',
    values: { title: 'Newest' },
    error: 'Choose a resolution.',
    resolutions: [],
  });
  assert({
    given:
      'a native settings answer and reads from another member, command and rematch',
    should:
      'expire in five minutes, disclose only its exact owner context, keep one latest answer per member and hand back a refused draft with its error',
    actual: [
      found,
      wrongMember,
      wrongCommand.kind,
      wrongSource.kind,
      expiries,
      data.size,
      exported,
      otherExport,
      await readRoomDraftAnswer(store, member, other, null),
    ],
    expected: [
      state,
      {
        kind: 'refused',
        values: {},
        error: 'This settings preview expired. Choose your settings again.',
      },
      'refused',
      'refused',
      [300, 300],
      1,
      [state.values],
      [],
      {
        kind: 'refused',
        values: { title: 'Newest' },
        error: 'Choose a resolution.',
      },
    ],
  });
  await eraseRoomDraftAnswer(store, member);
  assert({
    given: 'account closure clears the latest draft',
    should: 'remove its ephemeral copy',
    actual: await exportRoomDraftAnswer(store, member),
    expected: [],
  });
});
