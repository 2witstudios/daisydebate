import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLocalCommandAction } from './local-command-action';

setupRitewayBun();
const scenarios = [
  {
    type: 'start-prep',
    passed: false,
    pending: true,
    forwarded: ['start-prep'],
    consent: [],
    error: false,
  },
  {
    type: 'finish-prep',
    passed: false,
    pending: true,
    forwarded: ['finish-prep'],
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
        return { values: {}, next: '/rooms/current' };
      },
    );
    const form = new FormData();
    form.set('type', scenario.type);
    const state = await action({ values: {} }, form);
    assert({
      given: 'the latest local device and withdrawal state',
      should:
        'forward permitted prep, explicitly fence Ready/Launch and retain withdrawal recovery',
      actual: [forwarded, intents, Boolean(state.error)],
      expected: [scenario.forwarded, scenario.consent, scenario.error],
    });
  });
}
