import { prepare } from './prepare';
import { preserve } from './preserve';
export type OriginalFrameBatches = ReturnType<typeof prepare>;
export const OriginalFrameBatches = { prepare, preserve };
