import { resumeTabFlag } from './resume-tab-flag';

/**
 * Whether this tab already sent its member to this Round and has not seen it render
 * (ISSUE-1035). A page that keeps failing must not take home and the lobby with it, so
 * one attempt holds until the Round renders.
 */
export const resumeAttemptPrefix = 'daisy:resume-attempt:';
const attempt = resumeTabFlag(resumeAttemptPrefix);

export const markResumeAttempt = attempt.mark;
export const attemptedResume = attempt.isSet;
/** The Round rendered, so resume may fire again. */
export const clearResumeAttempt = attempt.clear;
