import { Notice } from '../components/notice/notice';
import {
  rankedAgeComing,
  rankedAgeTitle,
} from '../../features/play/ranked-age';

/** Where a ranked control would be, for a member under the ranked floor. */
export function RankedAgeNotice() {
  return (
    <Notice tone="neutral" icon="lock" title={rankedAgeTitle}>
      {rankedAgeComing}
    </Notice>
  );
}
