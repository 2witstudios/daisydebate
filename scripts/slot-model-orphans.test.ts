import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findOrphans, liveWorktreeIds } from './slot-model';

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
          'daisy_wt_gone_admin',
          'daisy_wt_gone_admin_test',
          'daisy_wt_gone_admin_e2e',
          'daisy_wt_live1_admin',
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
          'daisy_wt_gone_admin',
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

  test('maps the captured browser namespaces to their owning worktrees', () => {
    const { ids: liveIds } = liveWorktreeIds([
      '/repo/.pu/worktrees/wt-j335qtll',
      '/repo/.pu/worktrees/wt-o5id7gtp',
    ]);
    const databases = [
      'daisy_wt_j335qtll_e2e',
      'daisy_wt_o5id7gtp_e2e',
      'daisy_wt_cfg86xxt_e2e',
    ];
    const namespaces = [
      'daisy-wt-j335qtll-e2e-realtime',
      'daisy-wt-j335qtll-e2e',
      'daisy-wt-o5id7gtp-e2e-realtime',
      'daisy-wt-o5id7gtp-e2e',
    ];
    assert({
      given:
        'the Delivery 6090 browser namespaces and both live worktree paths',
      should: 'retain both live slots and still select a retired slot database',
      actual: findOrphans({ liveIds, databases, namespaces }),
      expected: {
        ids: ['cfg86xxt'],
        databases: ['daisy_wt_cfg86xxt_e2e'],
        namespaces: [],
      },
    });
    assert({
      given: 'the same inventory after only the LL-2 owner retires',
      should: 'select the retired browser namespaces under the LL-2 slot id',
      actual: findOrphans({ liveIds: ['o5id7gtp'], databases, namespaces }),
      expected: {
        ids: ['cfg86xxt', 'j335qtll'],
        databases: ['daisy_wt_cfg86xxt_e2e', 'daisy_wt_j335qtll_e2e'],
        namespaces: ['daisy-wt-j335qtll-e2e', 'daisy-wt-j335qtll-e2e-realtime'],
      },
    });
  });

  test('protects a live worktree whose dev namespace looks like a sidecar', () => {
    const namespace = 'daisy-wt-feature-x-e2e-realtime';
    const database = 'daisy_wt_feature_x_e2e_realtime';
    assert({
      given:
        'a live slot with a literal e2e_realtime ending and a retired shorter slot',
      should: 'retain the namespace and database of the live literal slot',
      actual: findOrphans({
        liveIds: ['feature_x_e2e_realtime'],
        databases: [database],
        namespaces: [namespace],
      }),
      expected: { ids: [], databases: [], namespaces: [] },
    });
    assert({
      given:
        'a live browser owner and a retired slot whose name overlaps its namespace',
      should:
        'retain the Redis namespace and classify PostgreSQL by its own naming rules',
      actual: findOrphans({
        liveIds: ['feature_x'],
        databases: [database],
        namespaces: [namespace],
      }),
      expected: {
        ids: ['feature_x_e2e_realtime'],
        databases: [database],
        namespaces: [],
      },
    });
  });

  test('only selects names that fit the slot naming rules', () => {
    const longestRealtimeOwner = 'a'.repeat(19);
    const longestSharedOwner = 'b'.repeat(28);
    assert({
      given:
        'valid maximum-length browser namespaces mixed with malformed and foreign names',
      should:
        'select only the namespaces the browser can derive and canonical run databases',
      actual: findOrphans({
        liveIds: [],
        databases: [
          'daisy_wt_gone_admin_test_run_0a1b2c3d',
          'daisy_wt_gone_e2e_test_run_0a1b2c3d',
          'other_wt_gone_test_run_0a1b2c3d',
        ],
        namespaces: [
          `daisy-wt-${longestRealtimeOwner}-e2e-realtime`,
          `daisy-wt-${longestRealtimeOwner}a-e2e-realtime`,
          `daisy-wt-${longestSharedOwner}-e2e`,
          'daisy-wt-feature_x-e2e-realtime',
          'daisy-wt-feature--x-e2e-realtime',
          'daisy-wt-Foreign-e2e-realtime',
          'daisy-e2e-realtime',
          'other-wt-gone-e2e-realtime',
        ],
      }),
      expected: {
        ids: [longestRealtimeOwner, longestSharedOwner, 'gone'],
        databases: ['daisy_wt_gone_admin_test_run_0a1b2c3d'],
        namespaces: [
          `daisy-wt-${longestRealtimeOwner}-e2e-realtime`,
          `daisy-wt-${longestSharedOwner}-e2e`,
        ],
      },
    });
  });
});
