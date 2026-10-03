/**
 * Where each Train action goes. There is no backend yet, so each is a
 * navigation to the next mock screen. The real operations replace these in
 * this file and nowhere else.
 */
export const trainDestinations = {
  hub: '/train',
  welcome: '/train/welcome',
  practice: '/train/practice',
  practiceLive: '/train/practice/live',
  practiceUnavailable: '/train/practice/unavailable',
  practiceDebrief: '/train/practice/debrief',
  drill: '/train/drill',
  review: '/train/review',
  customRules: '/train/rules',
  findRanked: '/lobby?mode=ranked',
} as const;
