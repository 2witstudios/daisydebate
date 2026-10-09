import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findElements, byText } from '../../test-support/find-elements';
import { AssemblyReadiness } from './assembly-readiness';

setupRitewayBun();
const base = {
  version: 7,
  participants: [
    {
      id: 'seat',
      actorId: 'viewer',
      kind: 'human' as const,
      role: 'judge' as const,
      slot: 0,
      needsReady: true,
      ready: 'not-ready' as const,
      eligible: true,
    },
  ],
  readiness: { available: true, version: 7, readyActorIds: [] },
  capabilities: {
    canReady: true,
    host: true,
    canStart: false,
    canStartPrep: false,
    canFinishPrep: false,
  },
  startRefusal: 'not-ready' as const,
};
const action = async (_form: FormData) => {};
const props = {
  view: base,
  actorId: 'viewer',
  local: { devicesPassed: false, unreadyPending: false },
  action,
  commandIds: {
    ready: 'ready-id',
    unready: 'unready-id',
    'start-round': 'launch-id',
    'start-prep': 'prep-id',
    'finish-prep': 'finish-id',
  },
};

describe('native room readiness and Launch controls', () => {
  test('judge Ready submits a versioned command through the injected real action', () => {
    const tree = AssemblyReadiness(props);
    const form = findElements(tree, (element) => element.type === 'form')[0];
    assert({
      given: 'an eligible judge without local device checks',
      should:
        'keep a native form action with the current version and command identity',
      actual: [
        form?.props.action === action,
        findElements(form, (element) => element.type === 'input').map(
          (input) => [input.props.name, input.props.value],
        ),
        byText(tree, 'button', 'I am ready')?.props.disabled,
      ],
      expected: [
        true,
        [
          ['type', 'ready'],
          ['expectedVersion', '7'],
          ['commandId', 'ready-id'],
        ],
        false,
      ],
    });
  });

  test('Launch follows CAP capability and local invalidation fence', () => {
    const allowed = {
      ...props,
      view: {
        ...base,
        capabilities: { ...base.capabilities, canStart: true },
        startRefusal: null,
      },
    };
    assert({
      given: 'CAP permits Launch, then a local unready remains unacknowledged',
      should: 'block Launch immediately without changing the server projection',
      actual: [
        byText(AssemblyReadiness(allowed), 'button', 'Launch')?.props.disabled,
        byText(
          AssemblyReadiness({
            ...allowed,
            local: { devicesPassed: true, unreadyPending: true },
          }),
          'button',
          'Launch',
        )?.props.disabled,
        allowed.view.capabilities.canStart,
      ],
      expected: [false, true, true],
    });
  });

  test('non-host receives no Launch control', () => {
    const tree = AssemblyReadiness({
      ...props,
      view: {
        ...base,
        capabilities: { ...base.capabilities, host: false, canStart: true },
      },
    });
    assert({
      given: 'a seated participant without host authority',
      should: 'render Ready but no Launch submission',
      actual: [
        Boolean(byText(tree, 'button', 'I am ready')),
        Boolean(byText(tree, 'button', 'Launch')),
      ],
      expected: [true, false],
    });
  });

  test('device loss blocks a debater host before Unready can be acknowledged', () => {
    const view = {
      ...base,
      participants: [
        {
          ...base.participants[0]!,
          role: 'affirmative' as const,
          ready: 'ready' as const,
        },
      ],
      capabilities: { ...base.capabilities, canStart: true },
      startRefusal: null,
    };
    const tree = AssemblyReadiness({ ...props, view });
    assert({
      given:
        'CAP still reports ready while the human host has lost device checks',
      should: 'block Launch synchronously and still offer Unready',
      actual: [
        byText(tree, 'button', 'Launch')?.props.disabled,
        byText(tree, 'button', 'Not ready')?.props.disabled,
        view.participants[0]?.ready,
      ],
      expected: [true, false, 'ready'],
    });
  });
});
