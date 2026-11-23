import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mainBrowserGate } from './main-browser-gate';

setupRitewayBun();

const run = (id: number, conclusion: string | null) => ({
  id,
  conclusion,
  head_sha: 'a'.repeat(40),
  html_url: `https://github.test/runs/${String(id)}`,
});

describe('mainBrowserGate()', () => {
  test('a green main', () => {
    assert({
      given: "main's latest Browser E2E push run succeeded",
      should: 'merge',
      actual: mainBrowserGate(run(1, 'success'), undefined).merge,
      expected: true,
    });
    assert({
      given: 'a green main and a --fixes-main-run flag',
      should: 'refuse, so a stale flag is never carried forward',
      actual: mainBrowserGate(run(1, 'success'), 1).merge,
      expected: false,
    });
  });

  test('a red main', () => {
    for (const conclusion of ['failure', 'timed_out']) {
      assert({
        given: `main's latest Browser E2E push run concluded ${conclusion}`,
        should: 'refuse, naming the run and the way through',
        actual: mainBrowserGate(run(7, conclusion), undefined),
        expected: {
          merge: false,
          reason:
            "Main's latest Browser E2E run is red (https://github.test/runs/7). Merge only the PR that fixes or reverts it, with --fixes-main-run 7",
        },
      });
    }
    assert({
      given: 'a red main and the flag naming that exact run',
      should: 'merge',
      actual: mainBrowserGate(run(7, 'failure'), 7).merge,
      expected: true,
    });
    assert({
      given: 'a red main and the flag naming an older run',
      should: 'refuse',
      actual: mainBrowserGate(run(7, 'failure'), 6).merge,
      expected: false,
    });
  });

  test('no completed main run', () => {
    assert({
      given: 'no completed Browser E2E push run on main',
      should: 'refuse rather than merge unproven',
      actual: mainBrowserGate(undefined, undefined).merge,
      expected: false,
    });
  });
});
