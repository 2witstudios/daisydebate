import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  completionOwnership,
  initialCompletionOwnership,
} from './completion-ownership';
setupRitewayBun();

test('a dispatched action may consume its completion once', () => {
  const started = completionOwnership(initialCompletionOwnership(), {
    type: 'dispatch',
  }).state;
  const completed = completionOwnership(started, {
    type: 'complete',
    origin: started.sequence,
  });
  const repeated = completionOwnership(completed.state, {
    type: 'complete',
    origin: started.sequence,
  });
  assert({
    given: 'one dispatch and two observations of its success',
    should: 'apply once and preserve consumed state on repetition',
    actual: [
      completed.apply,
      repeated.apply,
      repeated.state === completed.state,
    ],
    expected: [true, false, true],
  });
});

test('accepted navigation supersedes completion before any pathname changes', () => {
  const started = completionOwnership(initialCompletionOwnership(), {
    type: 'dispatch',
  }).state;
  const moved = completionOwnership(started, { type: 'navigate' }).state;
  const completed = completionOwnership(moved, {
    type: 'complete',
    origin: started.sequence,
  });
  assert({
    given: 'a newer navigation intent while the origin stays mounted',
    should: 'refuse the old completion without changing current state',
    actual: [completed.apply, completed.state === moved],
    expected: [false, true],
  });
});

test('an older answer cannot consume the newer action', () => {
  const first = completionOwnership(initialCompletionOwnership(), {
    type: 'dispatch',
  }).state;
  const second = completionOwnership(first, { type: 'dispatch' }).state;
  const old = completionOwnership(second, {
    type: 'complete',
    origin: first.sequence,
  });
  assert({
    given: 'two dispatches and the earlier answer',
    should: 'preserve the newer owner for its own answer',
    actual: [
      old.apply,
      old.state === second,
      completionOwnership(old.state, {
        type: 'complete',
        origin: second.sequence,
      }).apply,
    ],
    expected: [false, true, true],
  });
});

test('disposal is terminal', () => {
  const started = completionOwnership(initialCompletionOwnership(), {
    type: 'dispatch',
  }).state;
  const disposed = completionOwnership(started, { type: 'dispose' }).state;
  assert({
    given: 'a disposed action and all later event kinds',
    should: 'never navigate or reopen the disposed lifetime',
    actual: ['dispatch', 'navigate', 'dispose']
      .map(
        (type) =>
          completionOwnership(disposed, { type } as {
            type: 'dispatch' | 'navigate' | 'dispose';
          }).state === disposed,
      )
      .concat(
        completionOwnership(disposed, {
          type: 'complete',
          origin: started.sequence,
        }).apply,
      ),
    expected: [true, true, true, false],
  });
});
