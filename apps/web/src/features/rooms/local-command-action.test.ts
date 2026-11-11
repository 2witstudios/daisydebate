import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLocalCommandAction } from './local-command-action';
import { idle, moved } from '../forms/form-state';

setupRitewayBun();
const scenarios = [
  {
    type: 'update-config',
    passed: false,
    pending: true,
    forwarded: ['update-config'],
    consent: [],
    error: false,
  },
  {
    type: 'start-round',
    passed: false,
    pending: false,
    forwarded: [],
    consent: [],
    error: true,
  },
  {
    type: 'start-round',
    passed: true,
    pending: true,
    forwarded: [],
    consent: [],
    error: true,
  },
  {
    type: 'start-round',
    passed: true,
    pending: false,
    forwarded: ['start-round'],
    consent: [],
    error: false,
  },
  {
    type: 'ready',
    passed: false,
    pending: false,
    forwarded: [],
    consent: [],
    error: true,
  },
  {
    type: 'ready',
    passed: true,
    pending: false,
    forwarded: [],
    consent: ['ready'],
    error: false,
  },
  {
    type: 'unready',
    passed: false,
    pending: true,
    forwarded: [],
    consent: ['unready'],
    error: false,
  },
];
for (const scenario of scenarios) {
  test(`${scenario.type}: passed=${scenario.passed}, pending=${scenario.pending}`, async () => {
    const forwarded: string[] = [];
    const intents: string[] = [];
    const action = createLocalCommandAction(
      {
        readSnapshot: () => ({
          devicesPassed: scenario.passed,
          pending: scenario.pending,
        }),
        ready: async () => {
          intents.push('ready');
        },
        unready: async () => {
          intents.push('unready');
        },
      },
      async (_state, form) => {
        forwarded.push(String(form.get('type')));
        return moved('/rooms/current');
      },
    );
    const form = new FormData();
    form.set('type', scenario.type);
    const state = await action(idle(), form);
    assert({
      given: 'the latest local device and withdrawal state',
      should:
        'forward permitted prep, explicitly fence Ready/Launch and retain withdrawal recovery',
      actual: [forwarded, intents, state.kind === 'refused'],
      expected: [scenario.forwarded, scenario.consent, scenario.error],
    });
  });
}
