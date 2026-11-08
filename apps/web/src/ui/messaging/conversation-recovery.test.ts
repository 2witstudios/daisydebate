import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createConversationRecovery } from './conversation-recovery';
setupRitewayBun();

const world = () => {
  const waits: number[] = [];
  let refreshes = 0;
  let next: (() => void) | null = null;
  const recovery = createConversationRecovery({
    refresh: () => {
      refreshes += 1;
    },
    schedule: (run, wait) => {
      waits.push(wait);
      next = run;
      return () => {
        next = null;
      };
    },
  });
  return {
    recovery,
    waits,
    refreshes: () => refreshes,
    fire: () => {
      const run = next;
      next = null;
      run?.();
    },
    capture: () => next,
  };
};

test('a refused conversation bounds retries and waits for each server answer', () => {
  const page = world();
  page.recovery.refused('initial', 1000, 'page-read');
  page.fire();
  page.recovery.refused('initial', 1000, 'page-read');
  page.fire();
  const awaitingAnswer = page.refreshes();
  for (const answer of ['second', 'third', 'fourth', 'fifth']) {
    page.recovery.refused(answer, 1000, 'page-read');
    page.fire();
  }
  assert({
    given:
      'an unanswered refresh, repeated old render and persistent fresh refusals',
    should:
      'wait for a new answer before retrying and stop after three attempts',
    actual: { awaitingAnswer, refreshes: page.refreshes(), waits: page.waits },
    expected: { awaitingAnswer: 1, refreshes: 3, waits: [1000, 2000, 4000] },
  });
});

test('leaving a refused conversation permanently disposes its recovery', () => {
  const page = world();
  page.recovery.refused('initial', 1000, 'page-read');
  const staleTimer = page.capture();
  page.recovery.stop();
  staleTimer?.();
  page.recovery.refused('late answer', 1000, 'page-read');
  page.fire();
  assert({
    given: 'disposal before a timer fires, then a late timer and server answer',
    should: 'do no work and never resume the disposed owner',
    actual: [page.refreshes(), page.waits],
    expected: [0, [1000]],
  });
});

test('an answer from an older refresh cannot schedule work in a newer question', () => {
  const page = world();
  page.recovery.refused('initial', 1000, 'page-read');
  page.fire();
  page.recovery.refused('second', 2000, 'page-read');
  page.recovery.refused('initial', 1000, 'page-read');
  page.fire();
  assert({
    given: 'an old render arriving while a new refusal already owns its wait',
    should: 'keep the current wait and issue only its one refresh',
    actual: [page.refreshes(), page.waits],
    expected: [2, [1000, 4000]],
  });
});

test('an unrelated action render cannot answer a held recovery page read', () => {
  const page = world();
  page.recovery.refused('initial', 1000, 'page-read');
  page.fire();
  page.recovery.refused('unrelated-action', 1000, 'action-render');
  page.fire();
  const held = { refreshes: page.refreshes(), waits: [...page.waits] };
  page.recovery.refused('actual-held-answer', 1000, 'page-read');
  page.fire();
  assert({
    given:
      'a held page refresh followed by a distinct unrelated action render, then the real page answer',
    should:
      'keep the held attempt outstanding and preserve its remaining two-attempt budget',
    actual: {
      held,
      afterAnswer: { refreshes: page.refreshes(), waits: page.waits },
    },
    expected: {
      held: { refreshes: 1, waits: [1000] },
      afterAnswer: { refreshes: 2, waits: [1000, 2000] },
    },
  });
});
