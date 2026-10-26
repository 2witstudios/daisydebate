import { AssemblyCommandForm } from './assembly-command-form';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findElements, byText } from '../../test-support/find-elements';
import { StartControl, ReadyControl } from './assembly-readiness';

setupRitewayBun();
const base = {
  botAdmission: null,
  version: 7,
  participants: [
    {
      id: 'seat',
      actorId: 'viewer',
      label: 'Viewer',
      consentVersion: 8,
      kind: 'human' as const,
      role: 'judge' as const,
      slot: 0,
      needsReady: true,
      ready: 'not-ready' as const,
      eligible: true,
    },
  ],
  readiness: { available: true, version: 7, readyActorIds: [] },
  definition: { seats: { affirmative: 1, negative: 1, judge: 1 } },
  prep: { startedAt: null, remainingMs: null, finished: false },
  capabilities: { canReady: true, host: true, canStart: false },
  startRefusal: 'not-ready' as const,
};
const action = async () => ({ values: {} });
type Props = Parameters<typeof ReadyControl>[0];
const controls = (props: Props) => [
  ReadyControl(props),
  StartControl({ ...props, prep: null }),
];
const props = {
  view: base,
  actorId: 'viewer',
  local: { devicesPassed: false, unreadyPending: false },
  action,
  commandIds: {
    ready: 'ready-id',
    unready: 'unready-id',
    'start-round': 'launch-id',
  },
};

describe('native room readiness and Start round controls', () => {
  test('judge Ready submits a versioned command through the injected real action', () => {
    const tree = controls(props);
    const form = findElements(
      tree,
      (element) => element.type === AssemblyCommandForm,
    )[0];
    assert({
      given: 'an eligible judge without local device checks',
      should:
        'keep a native form action with the current version and command identity',
      actual: [
        form?.props.action === action,
        findElements(form, (element) => element.type === 'input').map(
          (input) => [input.props.name, input.props.value],
        ),
        byText(tree, 'button', 'I’m ready')?.props.disabled,
      ],
      expected: [
        true,
        [
          ['type', 'ready'],
          ['expectedVersion', '7'],
          ['commandId', 'ready-id'],
          ['expectedConsentVersion', '8'],
        ],
        false,
      ],
    });
  });

  test('Unready carries own consent revision and Start round carries none', () => {
    const tree = controls({
      ...props,
      view: {
        ...base,
        participants: [{ ...base.participants[0]!, ready: 'ready' }],
        capabilities: { ...base.capabilities, canStart: true },
      },
    });
    const forms = findElements(
      tree,
      (element) => element.type === AssemblyCommandForm,
    );
    assert({
      given: 'the viewer is ready at consent revision eight',
      should:
        'fence withdrawal using that participant revision without adding a readiness field to Start round',
      actual: forms.map((form) =>
        findElements(
          form,
          (element) =>
            element.type === 'input' &&
            element.props.name === 'expectedConsentVersion',
        ).map((input) => input.props.value),
      ),
      expected: [['8'], []],
    });
  });

  test('Start round follows CAP capability and local invalidation fence', () => {
    const allowed = {
      ...props,
      view: {
        ...base,
        capabilities: { ...base.capabilities, canStart: true },
        startRefusal: null,
      },
    };
    assert({
      given:
        'CAP permits Start round, then a local unready remains unacknowledged',
      should:
        'block Start round immediately without changing the server projection',
      actual: [
        byText(controls(allowed), 'button', 'Start round')?.props.disabled,
        byText(
          controls({
            ...allowed,
            local: { devicesPassed: true, unreadyPending: true },
          }),
          'button',
          'Start round',
        )?.props.disabled,
        allowed.view.capabilities.canStart,
      ],
      expected: [false, true, true],
    });
  });

  test('non-host receives no Start round control', () => {
    const tree = controls({
      ...props,
      view: {
        ...base,
        capabilities: { ...base.capabilities, host: false, canStart: true },
      },
    });
    assert({
      given: 'a seated participant without host authority',
      should: 'render Ready but no Start round submission',
      actual: [
        Boolean(byText(tree, 'button', 'I’m ready')),
        Boolean(byText(tree, 'button', 'Start round')),
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
    const tree = controls({ ...props, view });
    assert({
      given:
        'CAP still reports ready while the human host has lost device checks',
      should: 'block Start round synchronously and still offer Unready',
      actual: [
        byText(tree, 'button', 'Start round')?.props.disabled,
        byText(tree, 'button', 'Not ready')?.props.disabled,
        view.participants[0]?.ready,
      ],
      expected: [true, false, 'ready'],
    });
  });

  test('Start round names what it waits on', () => {
    const bot = (role: 'affirmative' | 'negative') => ({
      ...base.participants[0]!,
      id: role,
      actorId: role,
      kind: 'bot' as const,
      role,
      needsReady: false,
    });
    const waiting = controls(props);
    const clear = controls({
      ...props,
      view: {
        ...base,
        participants: [
          { ...base.participants[0]!, ready: 'ready' },
          bot('affirmative'),
          bot('negative'),
        ],
        capabilities: { ...base.capabilities, canStart: true },
        startRefusal: null,
      },
    });
    assert({
      given: 'open debater seats and the unready viewer, then a ready room',
      should: 'list the seats and the viewer, then nothing',
      actual: [
        byText(waiting, 'p', 'Waiting on')?.props.children,
        byText(clear, 'p', 'Waiting on'),
      ],
      expected: ['Waiting on: Affirmative, Negative, You', undefined],
    });
  });
});

test('host Start round refuses unavailable admission without changing Ready or command authority', () => {
  const tree = StartControl({
    ...props,
    prep: null,
    view: {
      ...base,
      botAdmission: { kind: 'unavailable' },
      capabilities: { ...base.capabilities, canStart: true },
    },
  });
  const button = findElements(tree, (element) => element.type === 'button')[0];
  assert({
    given: 'an otherwise startable host Room with unavailable bot admission',
    should: 'disable only the Start round submission',
    actual: button?.props.disabled,
    expected: true,
  });
});
