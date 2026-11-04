import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialManagerState,
  reduceManager,
  type ManagerState,
} from '../../features/documents/document-manager-state';
import { loadedDocuments } from '../../features/documents/open-documents';
import { createDocumentSync, type StoredDocument } from './document-sync';
import {
  manualDraftResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';

setupRitewayBun();

/**
 * The rule, not each bug: whatever order load, save, focus and edit arrive in,
 * and however their answers cross, text the person typed is never overwritten
 * or dropped, and another tab's text is never overwritten unseen. Two reviews
 * found this path's bugs one at a time, so this walks the orderings instead,
 * over the real sync owner and the real manager reducer. The server is real
 * enough to refuse a stale compare-and-swap, and every answer waits for a step.
 */
const OPERATIONS = [
  'edit', // the person types
  'load', // the frame mounts: flush, then load
  'open', // the person opens the document's tab
  'flush', // a save goes out
  'focus', // the window is looked at again
  'other', // another tab commits text
  'answer', // the oldest waiting answer arrives
  'refuse', // the oldest waiting answer is a capacity refusal
  'lose', // the oldest waiting save commits, but its answer is lost
] as const;
type Operation = (typeof OPERATIONS)[number];

type Waiting =
  | {
      readonly kind: 'save';
      readonly html: string;
      readonly expectedRevision: number;
      readonly resolve: (answer: {
        status: 'saved' | 'conflict';
        revision: number;
      }) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly kind: 'read';
      readonly ids: readonly string[];
      readonly resolve: (documents: readonly StoredDocument[]) => void;
      readonly reject: (error: Error) => void;
    };

const settleMicrotasks = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const refusal = () => Object.assign(new Error('full'), { status: 503 });

const world = () => {
  let server = { ...stored('a', 1), html: '<p>start</p>' };
  /** Every text anyone other than this person committed, and whether it was shown. */
  const others = new Map<string, boolean>();
  const violations: string[] = [];
  const waiting: Waiting[] = [];
  const clock = manualTimers();
  let state: ManagerState = initialManagerState();
  let typed: string | null = null;
  /** Text of this person's the server took; another tab may later replace it, knowingly. */
  const landed = new Set<string>();
  let count = 0;

  const dispatch = (action: Parameters<typeof reduceManager>[1]) => {
    state = reduceManager(state, action);
  };
  const shown = () =>
    loadedDocuments(state.opened).find((d) => d.id === 'a')?.html;
  const noteShown = () => {
    const text = shown();
    if (text !== undefined && others.has(text)) others.set(text, true);
  };

  const commit = (html: string) => {
    server = { ...server, html, revision: server.revision + 1 };
  };
  /** A stale save must meet the compare-and-swap, never replace what it has not seen. */
  const commitMine = (html: string) => {
    if (others.get(server.html) === false)
      violations.push(`overwrote ${server.html} unseen with ${html}`);
    commit(html);
    landed.add(html);
  };
  const sync = createDocumentSync({
    ...manualDraftResources('ordering', {
      storage: memoryStorage(),
      timers: clock.timers,
    }),
    principalId: 'p',
    api: {
      recent: async () => 'a',
      create: async () => stored('new'),
      read: (ids) =>
        new Promise((resolve, reject) =>
          waiting.push({ kind: 'read', ids, resolve, reject }),
        ),
      save: ({ html, expectedRevision }) =>
        new Promise((resolve, reject) =>
          waiting.push({
            kind: 'save',
            html,
            expectedRevision,
            resolve,
            reject,
          }),
        ),
    },
    onConflict: () => {},
  });
  sync.subscribeServerText((id, html) =>
    dispatch({ type: 'doc/server-text', id, html, now: 'n' }),
  );

  const applySave = (one: Extract<Waiting, { kind: 'save' }>) => {
    if (one.expectedRevision !== server.revision) return false;
    commitMine(one.html);
    return true;
  };
  const answerNext = async (how: 'answer' | 'refuse' | 'lose') => {
    const one = waiting.shift();
    if (!one) return;
    if (how === 'refuse') one.reject(refusal());
    else if (one.kind === 'read') {
      if (how === 'lose') one.reject(new Error('lost'));
      else one.resolve(one.ids.includes('a') ? [server] : []);
    } else if (how === 'lose') {
      applySave(one);
      one.reject(new Error('lost'));
    } else
      one.resolve(
        applySave(one)
          ? { status: 'saved', revision: server.revision }
          : { status: 'conflict', revision: server.revision },
      );
    await settleMicrotasks();
  };

  const run = async (operation: Operation) => {
    switch (operation) {
      case 'edit':
        // A person can only type into a document on screen.
        if (shown() === undefined) break;
        count += 1;
        typed = `<p>typed ${count}</p>`;
        dispatch({ type: 'doc/update', id: 'a', html: typed, now: 'n' });
        sync.change('a', typed);
        break;
      case 'load':
        void sync
          .flush()
          .then(() => sync.load())
          .then((documents) => dispatch({ type: 'doc/loaded', documents }))
          .catch(() => {});
        break;
      case 'open':
        dispatch({ type: 'doc/opening', id: 'a', title: 'A' });
        void sync.open('a').then(
          (document) => {
            if (document) dispatch({ type: 'doc/add', document });
          },
          () => dispatch({ type: 'doc/failed', id: 'a' }),
        );
        break;
      case 'flush':
        void sync.flush().catch(() => {});
        break;
      case 'focus':
        void sync.recheck(state.tabs.open);
        break;
      case 'other':
        count += 1;
        others.set(`<p>other ${count}</p>`, false);
        commit(`<p>other ${count}</p>`);
        break;
      case 'answer':
      case 'refuse':
      case 'lose':
        await answerNext(operation);
        break;
    }
    await settleMicrotasks();
    noteShown();
    if (typed !== null && shown() !== typed && shown() !== undefined) {
      const text = shown()!;
      // Only an offer the person can see may stand in for what they typed.
      if (!keptSomewhere(typed))
        violations.push(`showed ${text} over ${typed}`);
    }
  };
  const keptSomewhere = (text: string) =>
    landed.has(text) ||
    shown() === text ||
    sync.recoveryOffers().some((offer) => offer.copy.html === text);

  /** Everything still out answers, and the owner gets the chance to save. */
  const settle = async () => {
    for (let pass = 0; pass < 6; pass += 1) {
      while (waiting.length > 0) await answerNext('answer');
      void sync.flush().catch(() => {});
      await settleMicrotasks();
    }
    while (waiting.length > 0) await answerNext('answer');
    await settleMicrotasks();
    noteShown();
    if (typed !== null && !keptSomewhere(typed))
      violations.push(`dropped ${typed}: server ${server.html}`);
  };

  return { run, settle, violations };
};

const check = async (sequence: readonly Operation[]) => {
  const w = world();
  // Every journey starts with the document on screen, as a person sees it.
  await w.run('open');
  await w.run('answer');
  for (const operation of sequence) await w.run(operation);
  await w.settle();
  return w.violations.map((violation) => `${sequence.join(' ')}: ${violation}`);
};

const orderings = function* (length: number): Generator<readonly Operation[]> {
  if (length === 0) {
    yield [];
    return;
  }
  for (const rest of orderings(length - 1))
    for (const operation of OPERATIONS) yield [...rest, operation];
};

/** Deterministic: a failure names its sequence, and the same seed finds it again. */
const seeded = function* (
  count: number,
  length: number,
): Generator<readonly Operation[]> {
  let seed = 20261104;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < count; i += 1)
    yield Array.from({ length }, () => OPERATIONS[next() % OPERATIONS.length]!);
};

const firstFailures = async (sequences: Iterable<readonly Operation[]>) => {
  const failures: string[] = [];
  let walked = 0;
  for (const sequence of sequences) {
    walked += 1;
    failures.push(...(await check(sequence)));
    if (failures.length >= 5) break;
  }
  return { failures, walked };
};

describe('typed text, in any order', () => {
  test('every ordering of five operations', async () => {
    const { failures, walked } = await firstFailures(orderings(5));
    assert({
      given: `all ${walked} orderings of load, open, save, focus, edit, another tab and crossed answers`,
      should: 'never overwrite or drop typed text, nor another tab’s unseen',
      actual: failures,
      expected: [],
    });
  }, 120_000);

  test('long generated orderings', async () => {
    const { failures, walked } = await firstFailures(seeded(3_000, 14));
    assert({
      given: `${walked} generated orderings of 14 operations`,
      should: 'never overwrite or drop typed text, nor another tab’s unseen',
      actual: failures,
      expected: [],
    });
  }, 120_000);
});
