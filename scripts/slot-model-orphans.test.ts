import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findOrphans } from './slot-model';

setupRitewayBun();

describe('orphan detection', () => {
  test('selects only slots whose worktree is gone', () => {
    assert({
      given: 'databases and namespaces of live, removed and main slots',
      should: 'drop only the removed slot and never main or unknown names',
      actual: findOrphans({
        liveIds: ['live1', 'live1_x'],
        databases: [
          'daisy',
          'daisy_test',
          'daisy_template',
          'daisy_wt_live1',
          'daisy_wt_live1_test',
          'daisy_wt_live1_e2e',
          'daisy_wt_live1_x',
          'daisy_wt_gone',
          'daisy_wt_gone_test',
          'daisy_wt_gone_e2e',
          'daisy_wt_gone_test_run_0a1b2c3d',
          'daisy_wt_gone_admin_test',
          'daisy_wt_gone_admin_e2e',
          'daisy_wt_live1_admin_test',
          'daisy_wt_live1_test_run_0a1b2c3d',
          'daisy_wt_Bad',
          'postgres',
        ],
        namespaces: [
          'daisy',
          'daisy-e2e',
          'daisy-wt-live1',
          'daisy-wt-live1-e2e',
          'daisy-wt-live1-x',
          'daisy-wt-gone',
          'daisy-wt-gone-e2e',
          'daisy-wt-',
        ],
      }),
      expected: {
        ids: ['gone'],
        databases: [
          'daisy_wt_gone',
          'daisy_wt_gone_admin_e2e',
          'daisy_wt_gone_admin_test',
          'daisy_wt_gone_e2e',
          'daisy_wt_gone_test',
          'daisy_wt_gone_test_run_0a1b2c3d',
        ],
        namespaces: ['daisy-wt-gone', 'daisy-wt-gone-e2e'],
      },
    });
  });
});
