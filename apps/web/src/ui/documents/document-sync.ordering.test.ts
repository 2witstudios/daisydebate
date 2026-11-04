import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync,
  type DocumentsApi,
  type SaveResult,
  type StoredDocument,
} from './document-sync';
import {
  manualDraftResources,
  manualTimers,
  memoryStorage,
  stored,
} from './document-sync.test-support';
import {
  initialManagerState,
  reduceManager,
  type ManagerAction,
  type ManagerState,
} from '../../features/documents/document-manager-state';
import { loadedDocuments } from '../../features/documents/open-documents';

setupRitewayBun();

/** A request the fake server holds until a step answers it. */
type SaveWaiting = {
  readonly kind: 'save';
  readonly id: string;
  readonly html: string;
  readonly expectedRevision: number;
  readonly resolve: (answer: SaveResult) => void;
  readonly reject: (error: Error) => void;
  applied?: 'saved' | 'conflict' | 'gone';
  rev?: number;
};
type Waiting =
  | SaveWaiting
  | {
      readonly kind: 'read';
      readonly snap: readonly StoredDocument[];
      readonly resolve: (documents: readonly StoredDocument[]) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly kind: 'create';
      readonly resolve: (document: StoredDocument) => void;
      readonly reject: (error: Error) => void;
    };

/**
 * The rule, not each bug: whatever order load, save, focus, edit, delete, reload and
 * their crossing answers arrive in, a word the person typed ends on the server or in a
 * stored draft a reload would find, and a save never replaces text it has not seen.
 * Each mount is a fresh reducer over the real sync owner; edits build on what is shown;
 * timers are an operation; answers come in either order. Written by the scoped review of
 * PR 650, after this path produced three rounds of typed-work blockers.
 */
const ALL = [
  'edit',
  'edit',
  'edit',
  'remount',
  'open',
  'closeTab',
  'flush',
  'focus',
  'timer',
  'other',
  'apply',
  'answerOld',
  'answerNew',
  'refuse',
  'lose',
  'reload',
  'deleteElsewhere',
  'saveAsNew',
  'restore',
] as const;
const OPS = ALL.filter((o) => !(process.env.SKIP ?? '').split(',').includes(o));
type Op = (typeof ALL)[number];
const settleM = async () => {
  for (let i = 0; i < 14; i++) await Promise.resolve();
};
const refusal = () => Object.assign(new Error('full'), { status: 503 });
const nf = () => Object.assign(new Error('nf'), { status: 404 });
const tokensOf = (h: string) => h.match(/[to]\d+/g) ?? [];
const world = (allowRestore: boolean) => {
  const server = new Map<string, StoredDocument>([
    ['a', { ...stored('a', 1), html: '<p>start</p>' }],
  ]);
  const storage = memoryStorage();
  const v: string[] = [];
  const clock = manualTimers();
  let n = 0;
  const typed = new Set<string>();
  let explicit = false;
  const waiting: Waiting[] = [];
  let made = 0;
  const api: DocumentsApi = {
    recent: async () => (server.has('a') ? 'a' : null),
    read: (ids) =>
      new Promise((resolve, reject) =>
        waiting.push({
          kind: 'read',
          snap: ids.flatMap((i) =>
            server.get(i) ? [{ ...server.get(i)! }] : [],
          ),
          resolve,
          reject,
        }),
      ),
    create: () =>
      new Promise((resolve, reject) =>
        waiting.push({ kind: 'create', resolve, reject }),
      ),
    save: ({ id, html, expectedRevision }) =>
      new Promise((resolve, reject) =>
        waiting.push({
          kind: 'save',
          id,
          html,
          expectedRevision,
          resolve,
          reject,
        }),
      ),
  };
  const newOwner = () =>
    createDocumentSync({
      ...manualDraftResources('o' + made++, { storage, timers: clock.timers }),
      principalId: 'p',
      api,
      onConflict: () => {},
    });
  let sync = newOwner();
  let state: ManagerState = initialManagerState();
  let frame = 0;
  const dispatchIn = (f: number) => (a: ManagerAction) => {
    if (f === frame) state = reduceManager(state, a);
  };
  let unsub = sync.subscribeServerText((id, html) =>
    dispatchIn(frame)({ type: 'doc/server-text', id, html, now: 'n' }),
  );
  const mount = () => {
    frame++;
    state = initialManagerState();
    const d = dispatchIn(frame);
    const s = sync;
    void s
      .flush()
      .then(() => s.load())
      .then((docs) => d({ type: 'doc/loaded', documents: docs }))
      .catch(() => {});
  };
  const active = () => {
    const id = state.tabs.active;
    return id === null
      ? undefined
      : loadedDocuments(state.opened).find((x) => x.id === id);
  };
  const apply = (w: SaveWaiting) => {
    if (w.applied !== undefined) return;
    const cur = server.get(w.id);
    if (!cur) {
      w.applied = 'gone';
      return;
    }
    if (cur.revision !== w.expectedRevision) {
      w.applied = 'conflict';
      return;
    }
    if (!explicit)
      for (const t of tokensOf(cur.html))
        if (!w.html.includes(t))
          v.push(`save over ${t}: ${cur.html} -> ${w.html}`);
    server.set(w.id, { ...cur, html: w.html, revision: cur.revision + 1 });
    w.applied = 'saved';
    w.rev = cur.revision + 1;
  };
  const answer = async (w: Waiting, how: 'answer' | 'refuse' | 'lose') => {
    if (w.kind === 'save') {
      if (how === 'refuse' && w.applied === undefined) {
        w.reject(refusal());
      } else {
        apply(w);
        if (how !== 'answer') w.reject(new Error('lost'));
        else if (
          w.applied === 'gone' ||
          (w.applied === 'conflict' && !server.has(w.id))
        )
          w.reject(nf());
        else
          w.resolve({
            status: w.applied === 'saved' ? 'saved' : 'conflict',
            revision:
              w.applied === 'saved' ? w.rev! : server.get(w.id)!.revision,
          });
      }
    } else if (w.kind === 'read') {
      if (how === 'answer') w.resolve(w.snap);
      else w.reject(how === 'refuse' ? refusal() : new Error('lost'));
    } else {
      if (how === 'answer') {
        const id = 'n' + ++n;
        const d = { ...stored(id, 1), html: '<p></p>' };
        server.set(id, d);
        w.resolve({ ...d });
      } else w.reject(refusal());
    }
    await settleM();
  };
  const run = async (op: Op) => {
    switch (op) {
      case 'edit': {
        const d = active();
        if (!d) break;
        n++;
        const t = 't' + n;
        typed.add(t);
        const html = d.html.replace(/<\/p>$/, ` ${t}</p>`);
        state = reduceManager(state, {
          type: 'doc/update',
          id: d.id,
          html,
          now: 'n',
        });
        sync.change(d.id, html);
        break;
      }
      case 'remount':
        mount();
        break;
      case 'open': {
        const id = [...server.keys()].pop();
        if (!id) break;
        const cur = state.opened.find(
          (o) => (o.kind === 'loaded' ? o.document.id : o.id) === id,
        );
        if (cur && cur.kind !== 'failed') {
          state = reduceManager(state, { type: 'tabs/open', id });
          break;
        }
        state = reduceManager(state, { type: 'doc/opening', id, title: id });
        const d = dispatchIn(frame);
        const s = sync;
        void s.open(id).then(
          (doc) => {
            if (doc) d({ type: 'doc/add', document: doc });
            else d({ type: 'drive/remove', id });
          },
          () => d({ type: 'doc/failed', id }),
        );
        break;
      }
      case 'closeTab':
        if (state.tabs.active)
          state = reduceManager(state, {
            type: 'tabs/close',
            id: state.tabs.active,
          });
        break;
      case 'flush':
        void sync.flush().catch(() => {});
        break;
      case 'focus':
        void sync.recheck(state.tabs.open);
        break;
      case 'timer':
        clock.fire();
        break;
      case 'other': {
        const id = [...server.keys()][0];
        if (!id) break;
        const c = server.get(id)!;
        n++;
        server.set(id, {
          ...c,
          html: c.html.replace(/<\/p>$/, ` o${n}</p>`),
          revision: c.revision + 1,
        });
        break;
      }
      case 'apply': {
        const w = waiting.find(
          (x): x is SaveWaiting => x.kind === 'save' && x.applied === undefined,
        );
        if (w) apply(w);
        break;
      }
      case 'answerOld': {
        const w = waiting.shift();
        if (w) await answer(w, 'answer');
        break;
      }
      case 'answerNew': {
        const w = waiting.pop();
        if (w) await answer(w, 'answer');
        break;
      }
      case 'refuse': {
        const w = waiting.shift();
        if (w) await answer(w, 'refuse');
        break;
      }
      case 'lose': {
        const w = waiting.shift();
        if (w) await answer(w, 'lose');
        break;
      }
      case 'reload': {
        // With text nowhere else the browser asks first (beforeunload), and a person
        // who confirms has chosen to lose it, so it no longer counts against the rule.
        if (sync.holdsAnyUnstored()) {
          const safe = `${[...server.values()].map((d) => d.html).join(' ')} ${[...storage.dump().values()].join(' ')}`;
          for (const t of [...typed])
            if (!new RegExp(`\\b${t}\\b`).test(safe)) typed.delete(t);
        }
        void sync.flushKeepalive().catch(() => {});
        await settleM();
        const old = sync;
        old.dispose();
        unsub();
        sync = newOwner();
        unsub = sync.subscribeServerText((id, html) =>
          dispatchIn(frame)({ type: 'doc/server-text', id, html, now: 'n' }),
        );
        mount();
        break;
      }
      case 'deleteElsewhere': {
        const c = server.get('a');
        if (c) for (const t of tokensOf(c.html)) typed.delete(t);
        server.delete('a');
        break;
      }
      case 'saveAsNew': {
        const g = sync.firstNeedingCopy();
        if (!g) break;
        const d = dispatchIn(frame);
        void sync.saveAsNew(g).then(
          (c) => {
            if (c) {
              d({ type: 'doc/closed', id: g });
              d({ type: 'doc/add', document: c });
            }
          },
          () => {},
        );
        break;
      }
      case 'restore': {
        if (!allowRestore) break;
        const o = sync.recoveryOffers()[0];
        if (!o) break;
        const h = sync.restoreRecovered(o.documentId, o.copy.generation);
        if (h !== null) {
          explicit = true;
          state = reduceManager(state, {
            type: 'doc/update',
            id: o.documentId,
            html: h,
            now: 'n',
          });
          state = reduceManager(state, { type: 'tabs/open', id: o.documentId });
        }
        break;
      }
    }
    await settleM();
  };
  const drain = async () => {
    for (let p = 0; p < 8; p++) {
      let g = 0;
      while (waiting.length && g++ < 50)
        await answer(waiting.shift()!, 'answer');
      clock.fire();
      await settleM();
      void sync.flush().catch(() => {});
      await settleM();
    }
  };
  const finish = async () => {
    await drain();
    // The way out the page offers: the person saves what only it holds.
    for (let pass = 0; pass < 4; pass += 1) {
      const needing = sync.firstNeedingCopy();
      if (!needing) break;
      await run('saveAsNew');
      await drain();
    }
    // Durable truth: a reload would find each typed token on some server document, or in a stored draft.
    const onServer = [...server.values()].map((d) => d.html).join(' ');
    const inStore = [...storage.dump().values()].join(' ');
    if (!explicit)
      for (const t of typed) {
        const re = new RegExp(`\\b${t}\\b`);
        if (!re.test(onServer) && !re.test(inStore))
          v.push(
            `typed ${t} lost: server=[${onServer}] store=${inStore.length}`,
          );
      }
  };
  return { run, finish, v, mount };
};
const check = async (seq: readonly Op[], allowRestore = false) => {
  const w = world(allowRestore);
  w.mount();
  await w.run('answerOld');
  await w.run('answerOld');
  for (const o of seq) await w.run(o);
  await w.finish();
  return w.v;
};
const shrink = async (seq: Op[], allow: boolean) => {
  let cur = seq;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const c = cur.slice(0, i).concat(cur.slice(i + 1));
      if ((await check(c, allow)).length) {
        cur = c;
        changed = true;
        break;
      }
    }
  }
  return cur;
};
const seeded = function* (count: number, len: number) {
  let seed = 7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  for (let i = 0; i < count; i++)
    yield Array.from({ length: len }, () => OPS[next() % OPS.length]!);
};

/** Orders earlier reviews named: each lost text on its way to a fix. */
const NAMED: readonly (readonly Op[])[] = [
  ['edit', 'reload', 'answerNew', 'edit', 'reload', 'answerNew', 'edit'],
  [
    'edit',
    'reload',
    'answerNew',
    'edit',
    'reload',
    'answerNew',
    'edit',
    'reload',
  ],
  ['deleteElsewhere', 'edit', 'flush', 'answerOld', 'saveAsNew', 'edit'],
  ['edit', 'other', 'flush', 'answerOld', 'answerOld', 'saveAsNew', 'edit'],
];

const failures = async (allowRestore: boolean) => {
  const found: string[] = [];
  let walked = 0;
  for (const seq of [...NAMED, ...seeded(20_000, 14)]) {
    walked += 1;
    const violations = await check(seq, allowRestore);
    if (violations.length > 0) {
      const small = await shrink(seq as Op[], allowRestore);
      found.push(
        `${small.join(' ')} => ${(await check(small, allowRestore))[0]}`,
      );
      if (found.length >= 5) break;
    }
  }
  return { found, walked };
};

describe('typed text, in any order', () => {
  test('generated orderings', async () => {
    const { found, walked } = await failures(false);
    assert({
      given: `${walked} orderings of edit, remount, open, save, focus, timers, another tab, crossed answers, reload, delete and save as new`,
      should: 'leave every typed word on the server or in a stored draft',
      actual: found,
      expected: [],
    });
  }, 120_000);

  test('generated orderings with Restore', async () => {
    const { found, walked } = await failures(true);
    assert({
      given: `${walked} orderings that also restore an offer, which is a person's explicit choice`,
      should: 'never replace text a save has not seen',
      actual: found,
      expected: [],
    });
  }, 120_000);
});
