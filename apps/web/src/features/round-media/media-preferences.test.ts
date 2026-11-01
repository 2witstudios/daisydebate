import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearMutePreference,
  departedInSession,
  markDeparture,
  mediaPreferenceKey,
  readMutePreference,
  writeMutePreference,
} from './media-preferences';

setupRitewayBun();

/** A real Storage stand-in so scoped keys and enumerate behave as the DOM does. */
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

const host = () => ({
  session: new MemoryStorage(),
  local: new MemoryStorage(),
});

test('mute preference is scoped to one principal in one Round and never aliases another', () => {
  const scope = host();
  writeMutePreference('actor-a', 'round-1', true, scope);
  assert({
    given:
      'actor-a muted round-1, then read back under actor-b and a different Round',
    should:
      'keep that choice alone in its key and answer null for every other scope',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      readMutePreference('actor-b', 'round-1', scope),
      readMutePreference('actor-a', 'round-2', scope),
    ],
    expected: [true, null, null],
  });
});

test('an unset or leftover state is reported unknown, and toggling rewrites it', () => {
  const scope = host();
  assert({
    given: 'no prior choice read back under the same scope',
    should: 'report unknown, then report the confirmed replacement',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      (() => {
        writeMutePreference('actor-a', 'round-1', false, scope);
        return readMutePreference('actor-a', 'round-1', scope);
      })(),
    ],
    expected: [null, false],
  });
});

test('clearing a Round lifecycle ends only that principal-Round record', () => {
  const scope = host();
  writeMutePreference('actor-a', 'round-1', true, scope);
  writeMutePreference('actor-a', 'round-2', true, scope);
  writeMutePreference('actor-b', 'round-2', true, scope);
  clearMutePreference('actor-a', 'round-2', scope);
  assert({
    given: 'three scoped mutes with one cleared by principal and Round',
    should: 'drop exactly that record and keep the other two readable',
    actual: [
      readMutePreference('actor-a', 'round-1', scope),
      readMutePreference('actor-a', 'round-2', scope),
      readMutePreference('actor-b', 'round-2', scope),
    ],
    expected: [true, null, true],
  });
});

test('departure is session-scoped per principal and Round, never anonymous', () => {
  const scope = host();
  assert({
    given:
      'no departure recorded, an anonymous actor asked, then a member departure recorded',
    should:
      'answer no for the anonymous actor and no, then yes for the member who left',
    actual: [
      departedInSession('actor-a', 'round-1', scope),
      departedInSession('actor-a', 'round-1', scope),
      (() => {
        markDeparture('actor-a', 'round-1', scope);
        return departedInSession('actor-a', 'round-1', scope);
      })(),
      departedInSession('actor-a', 'round-2', scope),
    ],
    expected: [false, false, true, false],
  });
});

test('scoped keys never alias between accounts within the same Round', () => {
  assert({
    given: 'mute and departure keys for two principals in one Round',
    should: 'be distinct strings under the Round, each naming its kind',
    actual: [
      mediaPreferenceKey('mute', 'actor-a', 'round-1'),
      mediaPreferenceKey('mute', 'actor-b', 'round-1'),
      mediaPreferenceKey('left', 'actor-a', 'round-1'),
    ],
    expected: [
      'daisy:mute:media:actor-a:round-1',
      'daisy:mute:media:actor-b:round-1',
      'daisy:left:media:actor-a:round-1',
    ],
  });
});
