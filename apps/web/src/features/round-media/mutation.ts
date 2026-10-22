import { dispatchMediaMutation } from './vendor-dispatch';
import type {
  Claim,
  Intent,
  Store,
  MediaOperationInput,
} from './operation-context';
export function createMediaMutations(
  input: MediaOperationInput,
  buildProjection: Parameters<Store['readMediaSession']>[0]['buildProjection'],
) {
  const unsafe = async (claim: Claim, error: unknown) => {
    await input.store.markMediaUnsafe(claim.fence);
    const requestId = input.nextId();
    input.logger.log(
      'round.media.unsafe',
      {
        operation: 'round.media.reconcile',
        errorCode: 'INFRASTRUCTURE',
        requestId,
      },
      'Media recovery is unresolved',
    );
    input.reporter.capture(error, {
      requestId,
      route: '/api/rounds/:id/media/reconcile',
      errorCode: 'INFRASTRUCTURE',
    });
  };
  const mutate = async (
    claim: Claim,
    intent: Intent,
    authorize: Parameters<Store['beginMediaMutation']>[0]['authorize'],
  ) => {
    const requestId = input.nextId();
    return dispatchMediaMutation({
      persist: () =>
        input.store.beginMediaMutation({
          ...claim.fence,
          intent,
          buildProjection,
          authorize,
        }),
      dispatch: () => {
        switch (intent.kind) {
          case 'create':
            return input.media.createRoom(claim.roomName);
          case 'delete':
            return input.media.deleteRoom(claim.roomName);
          case 'remove':
            return input.media.remove(claim.roomName, intent.identity);
          case 'permissions':
            return input.media.permissions(
              claim.roomName,
              intent.identity,
              intent.payload,
            );
        }
      },
      settle: (id) => input.store.settleMediaMutation(id),
      unsafe: async () => {
        await input.store.markMediaUnsafe(claim.fence);
        input.logger.log(
          'round.media.unsafe',
          {
            operation: 'round.media.reconcile',
            errorCode: 'INFRASTRUCTURE',
            requestId,
          },
          'Media recovery is unresolved',
        );
      },
      deadline: input.deadline,
      reporter: input.reporter,
      requestId,
    });
  };

  return { unsafe, mutate };
}
