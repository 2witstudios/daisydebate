import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clearAccountMediaPreferences } from './account-signout-cleanup';

setupRitewayBun();

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(item: string): void {
    this.entries.delete(item);
  }
  setItem(item: string, value: string): void {
    this.entries.set(item, value);
  }
  getItem(item: string): string | null {
    return this.entries.get(item) ?? null;
  }
}

test('account-signout cleanup drops every actor-scoped media record and nothing else', () => {
  const storage = new MemoryStorage();
  storage.setItem('daisy:mute:media:actor-a:round-1', 'muted');
  storage.setItem('daisy:mute:media:actor-b:round-2', 'unmuted');
  storage.setItem('daisy:left:media:actor-a:round-3', '1');
  storage.setItem('daisy:checked-devices:room-x:actor-b', '{}');
  storage.setItem('daisy:something-else', 'keep');
  clearAccountMediaPreferences(storage);
  assert({
    given:
      'two mute records, one departure record, an actor-scoped device record, and an unrelated key',
    should:
      'drop only actor-scoped media lifetime records and keep the device choice and unrelated key',
    actual: [
      storage.getItem('daisy:mute:media:actor-a:round-1'),
      storage.getItem('daisy:mute:media:actor-b:round-2'),
      storage.getItem('daisy:left:media:actor-a:round-3'),
      storage.getItem('daisy:checked-devices:room-x:actor-b'),
      storage.getItem('daisy:something-else'),
    ],
    expected: [null, null, null, '{}', 'keep'],
  });
});

test('account-signout cleanup tolerates a null host', () => {
  assert({
    given: 'no storage host at all (no browser window)',
    should: 'not throw',
    actual: (() => {
      try {
        clearAccountMediaPreferences(null);
        return 'cleared';
      } catch {
        return 'threw';
      }
    })(),
    expected: 'cleared',
  });
});
