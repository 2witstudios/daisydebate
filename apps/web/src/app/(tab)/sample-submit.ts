import type { SampleSubmit } from '../../ui/tab/sample-form/sample-form';
import { sampleFormAction } from './sample-form-action';

/** The sample submit of every form on the page at `path`. */
export const sampleSubmit =
  (path: string): SampleSubmit =>
  (label) =>
    sampleFormAction.bind(null, path, label);
