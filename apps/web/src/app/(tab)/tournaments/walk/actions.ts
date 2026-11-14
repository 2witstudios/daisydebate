'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import {
  done,
  field,
  type FormState,
} from '../../../../features/forms/form-state';
import { requireTabRelease } from '../../../../features/tab/release';
import { tabRoutes } from '../../../../features/tab/routes';
import {
  parseSampleScene,
  SAMPLE_SCENE_COOKIE,
  serializeSampleScene,
} from '../../../../features/tab/sample/scene';
import { stayOn } from '../../../../server/form-action';

/**
 * Keeps the chosen sample viewer and moment in a session cookie. The posted
 * pair is untrusted: `parseSampleScene` is its trust boundary, and anything
 * else reads as the default scene.
 */
export async function chooseSampleScene(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  await requireTabRelease();
  const scene = parseSampleScene(
    `${field(form, 'viewer')}.${field(form, 'moment')}`,
  );
  (await cookies()).set(SAMPLE_SCENE_COOKIE, serializeSampleScene(scene), {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  revalidatePath(tabRoutes.walk);
  return stayOn(await headers(), tabRoutes.walk) ?? done();
}
