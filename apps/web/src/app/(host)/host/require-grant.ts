import { redirect } from 'next/navigation';
import { participantPathOf } from '../../../features/tab/routes';
import { requestSampleScene } from '../../../features/tab/sample/request-scene';
import {
  holdsGrant,
  type SampleScene,
} from '../../../features/tab/sample/scene';

/**
 * A host page's viewer. Anyone without a grant is sent to the participant
 * page at the same address without the `/host` prefix.
 */
export async function requireGrant(path: string): Promise<SampleScene> {
  const scene = await requestSampleScene();
  if (!holdsGrant(scene)) redirect(participantPathOf(path));
  return scene;
}
