import { cookies } from 'next/headers';
import { requireTabRelease } from '../release';
import {
  parseSampleScene,
  SAMPLE_SCENE_COOKIE,
  type SampleScene,
} from './scene';

/**
 * The sample viewer and moment this request chose on the walk page. Every Tab
 * page reads its scene here before anything else, so this refuses first while
 * the release is closed: a layout is not run again when someone moves between
 * the pages under it.
 */
export async function requestSampleScene(): Promise<SampleScene> {
  await requireTabRelease();
  return parseSampleScene((await cookies()).get(SAMPLE_SCENE_COOKIE)?.value);
}
