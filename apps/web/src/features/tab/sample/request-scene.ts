import { cookies } from 'next/headers';
import {
  parseSampleScene,
  SAMPLE_SCENE_COOKIE,
  type SampleScene,
} from './scene';

/** The sample viewer and moment this request chose on the walk page. */
export async function requestSampleScene(): Promise<SampleScene> {
  return parseSampleScene((await cookies()).get(SAMPLE_SCENE_COOKIE)?.value);
}
