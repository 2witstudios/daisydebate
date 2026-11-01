import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  completionOwnership,
  initialCompletionOwnership,
} from './completion-ownership';
setupRitewayBun();

test('a dispatched action may consume its completion once', () => {
  const started = completionOwnership(initialCompletionOwnership('request'), {
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
  const started = completionOwnership(initialCompletionOwnership('request'), {
    type: 'dispatch',
  }).state;
  const moved = completionOwnership(started, { type: 'navigate' }).state;
  const completed = completionOwnership(moved, {
    type: 'complete',
    origin: started.sequence,
  });
  assert({
    given: 'a newer navigation intent while the origin stays mounted',
    should:
      'refuse the old navigation while recording the independently committed send',
    actual: [completed.apply, completed.state.command.status],
    expected: [false, 'committed'],
  });
});

test('an older answer cannot consume the newer action', () => {
  const first = completionOwnership(initialCompletionOwnership('request'), {
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
  const started = completionOwnership(initialCompletionOwnership('request'), {
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

test('committed send reset is independent of navigation, in either server-prop order', () => {
  for (const propsFirst of [true, false]) {
    let state = completionOwnership(initialCompletionOwnership('first'), {
      type: 'dispatch',
    }).state;
    state = completionOwnership(state, { type: 'navigate' }).state;
    if (propsFirst)
      state = completionOwnership(state, {
        type: 'rendered',
        requestId: 'second',
      }).state;
    const success = completionOwnership(state, {
      type: 'complete',
      origin: state.sequence,
    });
    state = success.state;
    if (!propsFirst)
      state = completionOwnership(state, {
        type: 'rendered',
        requestId: 'second',
      }).state;
    assert({
      given: `${propsFirst ? 'props' : 'answer'} first after superseding a send`,
      should:
        'accept the durable result once and enable the fresh server-issued command without navigation',
      actual: [success.apply, state.command.id, state.command.status],
      expected: [false, 'second', 'draft'],
    });
    const retained = state;
    state = completionOwnership(state, {
      type: 'rendered',
      requestId: 'first',
    }).state;
    state = completionOwnership(state, {
      type: 'complete',
      origin: state.sequence,
    }).state;
    assert({
      given:
        'older props and duplicate committed answer after a fresh draft becomes available',
      should: 'leave the new command and draft owner untouched',
      actual: state === retained,
      expected: true,
    });
  }
});

test('failed and pending commands retain their exact identity across server props', () => {
  let state = initialCompletionOwnership('first');
  state = completionOwnership(state, {
    type: 'rendered',
    requestId: 'unused',
  }).state;
  assert({
    given: 'an unsent draft and a server render',
    should: 'keep the current command',
    actual: state.command.id,
    expected: 'first',
  });
  state = completionOwnership(state, { type: 'dispatch' }).state;
  state = completionOwnership(state, {
    type: 'rendered',
    requestId: 'second',
  }).state;
  const failed = completionOwnership(state, {
    type: 'failed',
    origin: state.sequence,
  }).state;
  assert({
    given: 'pending then failed send with fresh server props',
    should: 'keep the same request available for retry',
    actual: [state.command.id, failed.command.id, failed.command.status],
    expected: ['first', 'first', 'draft'],
  });
});

test('a retried unknown commit keeps identity until authoritative success', () => {
  let state = completionOwnership(initialCompletionOwnership('first'), {
    type: 'dispatch',
  }).state;
  const oldOrigin = state.sequence;
  state = completionOwnership(state, {
    type: 'failed',
    origin: oldOrigin,
  }).state;
  state = completionOwnership(state, {
    type: 'rendered',
    requestId: 'second',
  }).state;
  assert({
    given: 'transport loss after an unknown durable result',
    should: 'retain the exact command identity for an idempotent retry',
    actual: state.command.id,
    expected: 'first',
  });
  state = completionOwnership(state, { type: 'dispatch' }).state;
  const pendingRetry = state;
  const late = completionOwnership(state, {
    type: 'complete',
    origin: oldOrigin,
  });
  assert({
    given: 'an older committed answer while its retry is pending',
    should: 'leave the current origin and request untouched',
    actual: [late.apply, late.state === pendingRetry],
    expected: [false, true],
  });
  state = completionOwnership(state, {
    type: 'complete',
    origin: state.sequence,
  }).state;
  state = completionOwnership(state, { type: 'dispatch' }).state;
  const fresh = state;
  state = completionOwnership(state, {
    type: 'rendered',
    requestId: 'first',
  }).state;
  state = completionOwnership(state, {
    type: 'complete',
    origin: oldOrigin,
  }).state;
  assert({
    given: 'a fresh command with late used-ID offer and old completion',
    should: 'never reuse a spent ID or consume the fresh action',
    actual: [state === fresh, state.command.id],
    expected: [true, 'second'],
  });
});
