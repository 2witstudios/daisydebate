import { assert, setupRitewayBun, test } from 'riteway/bun';
import { adminDeployTarget } from './admin-deploy-target';
setupRitewayBun();
test('adminDeployTarget', () => {
  const managed = {
    id: 'new',
    state: 'started',
    config: {
      metadata: { fly_platform_version: 'v2', fly_process_group: 'app' },
      mounts: [{ volume: 'vol_state', path: '/var/lib/tailscale' }],
    },
  };
  const volumes = [
    {
      id: 'vol_state',
      name: 'admin_tailscale_state',
      region: 'ord',
      encrypted: true,
    },
  ];
  const old = {
    id: 'old',
    state: 'stopped',
    config: {
      metadata: { fly_platform_version: 'v2', fly_process_group: 'app' },
      mounts: null,
    },
  };
  assert({
    given: 'one volume-backed machine and stopped rollback machine',
    should: 'target only the persistent node',
    actual: adminDeployTarget([old, managed], volumes),
    expected: 'new',
  });
  assert({
    given: 'missing, duplicate or running volumeless machines',
    should: 'refuse before deploy touches any machine',
    actual: [
      [],
      [old],
      [managed, { ...managed, id: 'second' }],
      [managed, { ...old, state: 'started' }],
    ].map((value) => adminDeployTarget(value, volumes)),
    expected: [null, null, null, null],
  });
});
