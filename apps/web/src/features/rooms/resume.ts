/**
 * The returned member's eligibility to auto-resume their live Round
 * (ISSUE-879). The read already validated membership and the canonical href
 * server-side; resume takes that signed path only when an explicit departure
 * this session does not suppress it. Ownership lives in `resume-ownership`:
 * the same decision this helper expresses is the one the runtime consumes.
 */
export {
  resumeRoundHrefOf,
  mayResumeTab,
  resumeOwnershipStaleMs,
  type ResumeOwnership,
} from './resume-ownership';
