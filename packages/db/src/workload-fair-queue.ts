/**
 * Waiters grouped by fairness key and served round-robin across keys, FIFO within one.
 * One caller flooding a lane takes turns with every other caller instead of preceding them.
 */
export function createFairQueue<T>() {
  const byKey = new Map<string, T[]>();
  let size = 0;
  return {
    get size() {
      return size;
    },
    push(key: string, item: T) {
      const queue = byKey.get(key);
      if (queue) queue.push(item);
      else byKey.set(key, [item]);
      size++;
    },
    /** The oldest item of the next key in rotation; that key then moves to the back. */
    shift(): T | undefined {
      const next = byKey.entries().next();
      if (next.done) return undefined;
      const [key, queue] = next.value;
      const item = queue.shift()!;
      byKey.delete(key);
      if (queue.length) byKey.set(key, queue);
      size--;
      return item;
    },
    remove(key: string, item: T) {
      const queue = byKey.get(key);
      const index = queue?.indexOf(item) ?? -1;
      if (!queue || index < 0) return;
      queue.splice(index, 1);
      if (!queue.length) byKey.delete(key);
      size--;
    },
  };
}
