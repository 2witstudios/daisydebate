import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolve } from 'node:path';
import { reduceSecurityOverview } from './security-overview-model';
import {
  everyEvent,
  everyPartState,
  stepShape,
} from './security-overview-states.test-support';

setupRitewayBun();

const ROWS = '[key-1 key-2] [here there]';

/**
 * What each event does in each state, as `lists / sign-out / enrolment /
 * what is asked`. An event a state does not list is rejected there: the same
 * state object, and nothing asked.
 */
const TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    'unasked/idle/idle': {
      'read-asked': 'loading / idle / idle / asks read',
      'sign-out-asked': 'unasked / asking / idle / asks sign-out-others',
      'enrolment-asked': 'unasked / idle / waiting / asks enrol',
    },
    'loading/idle/idle': {
      'read-asked': 'loading / idle / idle / asks read',
      'read-answered': 'read [key-3] [here] / idle / idle / asks nothing',
      'read-answered unreachable':
        'read unavailable unavailable / idle / idle / asks nothing',
      'sign-out-asked': 'loading / asking / idle / asks sign-out-others',
      'enrolment-asked': 'loading / idle / waiting / asks enrol',
    },
    'read/idle/idle': {
      'read-asked': `rereading ${ROWS} / idle / idle / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / idle / idle / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / idle / idle / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / idle / idle / asks nothing',
      'sign-out-asked': `read ${ROWS} / asking / idle / asks sign-out-others`,
      'enrolment-asked': `read ${ROWS} / idle / waiting / asks enrol`,
    },
    'rereading/idle/idle': {
      'read-asked': `rereading ${ROWS} / idle / idle / asks read`,
      'read-answered': 'read [key-3] [here] / idle / idle / asks nothing',
      'read-answered unreachable':
        'read unavailable unavailable / idle / idle / asks nothing',
      'passkey-renamed':
        'rereading [key-1=Work laptop key-2] [here there] / idle / idle / asks read',
      'passkey-removed':
        'rereading [key-2] [here there] / idle / idle / asks read',
      'session-removed':
        'rereading [key-1 key-2] [here] / idle / idle / asks read',
      'sign-out-asked': `rereading ${ROWS} / asking / idle / asks sign-out-others`,
      'enrolment-asked': `rereading ${ROWS} / idle / waiting / asks enrol`,
    },
    'unavailable/idle/idle': {
      'read-asked':
        'rereading unavailable unavailable / idle / idle / asks read',
      'sign-out-asked':
        'read unavailable unavailable / asking / idle / asks sign-out-others',
      'enrolment-asked':
        'read unavailable unavailable / idle / waiting / asks enrol',
    },
    'read/asking/idle': {
      'read-asked': `rereading ${ROWS} / asking / idle / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / asking / idle / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / asking / idle / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / asking / idle / asks nothing',
      'sign-out-answered ok': `rereading ${ROWS} / idle / idle / asks read`,
      'sign-out-answered refused': `read ${ROWS} / failed / idle / asks nothing`,
      'enrolment-asked': `read ${ROWS} / asking / waiting / asks enrol`,
    },
    'read/asking-again/idle': {
      'read-asked': `rereading ${ROWS} / asking-again / idle / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / asking-again / idle / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / asking-again / idle / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / asking-again / idle / asks nothing',
      'sign-out-answered ok': `rereading ${ROWS} / idle / idle / asks read`,
      'sign-out-answered refused': `read ${ROWS} / failed / idle / asks nothing`,
      'enrolment-asked': `read ${ROWS} / asking-again / waiting / asks enrol`,
    },
    'read/failed/idle': {
      'read-asked': `rereading ${ROWS} / failed / idle / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / failed / idle / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / failed / idle / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / failed / idle / asks nothing',
      'sign-out-asked': `read ${ROWS} / asking-again / idle / asks sign-out-others`,
      'enrolment-asked': `read ${ROWS} / failed / waiting / asks enrol`,
    },
    'read/idle/waiting': {
      'read-asked': `rereading ${ROWS} / idle / waiting / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / idle / waiting / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / idle / waiting / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / idle / waiting / asks nothing',
      'sign-out-asked': `read ${ROWS} / asking / waiting / asks sign-out-others`,
      'enrolment-answered saved': `rereading ${ROWS} / idle / idle / asks read`,
      'enrolment-answered cancelled': `read ${ROWS} / idle / failed / asks nothing`,
    },
    'read/idle/failed': {
      'read-asked': `rereading ${ROWS} / idle / failed / asks read`,
      'passkey-renamed':
        'read [key-1=Work laptop key-2] [here there] / idle / failed / asks nothing',
      'passkey-removed':
        'read [key-2] [here there] / idle / failed / asks nothing',
      'session-removed':
        'read [key-1 key-2] [here] / idle / failed / asks nothing',
      'sign-out-asked': `read ${ROWS} / asking / failed / asks sign-out-others`,
      'enrolment-asked': `read ${ROWS} / idle / waiting / asks enrol`,
    },
  };

for (const [name, state] of everyPartState())
  test(`every event in the state "${name}"`, () => {
    const cells: Record<string, string> = {};
    for (const [eventName, event] of everyEvent(state)) {
      const step = reduceSecurityOverview(state, event);
      if (step.state !== state || step.effects.length > 0)
        cells[eventName] = stepShape(step.state, step.effects);
    }
    assert({
      given: `the state "${name}" and every event`,
      should: 'do what the table says, and reject what it does not list',
      actual: cells,
      expected: TRANSITIONS[name],
    });
  });

test('the table covers every shape of each part of the state', () => {
  assert({
    given: 'the states the table lists and the states the tests can build',
    should: 'be the same states',
    actual: Object.keys(TRANSITIONS).sort(),
    expected: everyPartState()
      .map(([name]) => name)
      .sort(),
  });
});

test('the model decides only from its inputs', async () => {
  const text = await Bun.file(
    resolve(import.meta.dir, 'security-overview-model.ts'),
  ).text();
  const ambient =
    /\b(setTimeout|setInterval|Date\.now|new Date|performance\.|Math\.random|window\.|document\.|fetch\(|await |Promise)/;
  assert({
    given: 'the security overview model',
    should: 'import no React and read no clock, timer, network or promise',
    actual: {
      ambient: ambient.test(text.replace(/Awaited</g, '')),
      imports: [...text.matchAll(/from '([^']+)'/g)]
        .map(([, spec]) => spec)
        .filter((spec) => !spec!.startsWith('.')),
    },
    expected: { ambient: false, imports: [] },
  });
});
