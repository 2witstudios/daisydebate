/**
 * What every event does in every shape of state. An event not listed for a state is
 * rejected: that state object back, and nothing asked. Read this as the specification:
 * a change here is a change of behaviour.
 */
export const TRANSITIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  waiting: {
    'tab-changed true': 'admitting(first,try0) | cancel:recovery, admit',
    'tab-changed false': 'waiting(elsewhere) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'waiting(checking) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'waiting(checking)',
    'read-requested view': 'waiting(checking)',
    'read-requested boundary': 'waiting(checking)',
  },
  elsewhere: {
    'tab-changed true': 'admitting(first,try0) | cancel:recovery, admit',
    'tab-changed unknown': 'waiting(checking) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'waiting(elsewhere) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'waiting(elsewhere)',
    'read-requested view': 'waiting(elsewhere)',
    'read-requested boundary': 'waiting(elsewhere)',
  },
  admitting: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, abort-admission',
    'tab-changed unknown': 'waiting(checking) | cancel:all, abort-admission',
    'page-left': 'ended | cancel:all, abort-admission',
    'frozen-page-restored': 'admitting(first,try0) | refresh-view',
    'round-ended': 'ended | cancel:all, abort-admission, forget-mute',
    'mute-restored': 'admitting(first,try0)',
    'admission-answered': 'connecting | connect',
    'admission-failed transient':
      'admitting(again,try1,pausing) | schedule:admission-retry',
    'admission-failed refused':
      'released(refused) | cancel:all, abort-admission, refresh-view',
    'read-requested view': 'admitting(first,try0)',
    'read-requested boundary': 'admitting(first,try0)',
  },
  connecting: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored': 'connecting | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored': 'connecting',
    'read-requested view': 'connecting',
    'read-requested boundary': 'connecting',
    connected:
      'live(establishing) cam:off mic:off read:requesting next:none apply:none | schedule:read-budget, start-read',
    'connect-failed transient':
      'released(transient) | cancel:all, release-connection, schedule:recovery',
  },
  'first read': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(establishing) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(establishing) cam:off mic:off read:requesting next:none apply:none',
    'read-requested wake':
      'live(establishing) cam:off mic:off read:requesting next:wanted apply:none',
    'read-requested view':
      'live(establishing) cam:off mic:off read:aborting next:wanted apply:none | abort-read',
    'read-requested boundary':
      'live(establishing) cam:off mic:off read:aborting next:wanted apply:none | abort-read',
    'read-answered ready':
      'live(establishing) cam:capturing mic:capturing read:none next:none apply:running | capture:camera, capture:microphone, schedule:capture-patience',
    'read-answered ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'read-answered unavailable':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed transient':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none | schedule:read-retry',
    'read-failed definite':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed ending':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed refused':
      'released(refused) | cancel:all, abort-read, release-connection, refresh-view',
    'read-aborted':
      'live(establishing) cam:off mic:off read:none next:none apply:none',
    'timer-fired read-budget':
      'released(transient) | cancel:all, abort-read, release-connection, schedule:recovery',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, abort-read, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(establishing) cam:off mic:off read:requesting next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(establishing) cam:off mic:off read:requesting next:none apply:none | start-audio',
    'forget-failed':
      'live(establishing) cam:missing mic:off read:requesting next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(establishing) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(establishing) cam:capturing mic:capturing read:requesting next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(establishing) cam:off mic:off read:requesting next:none apply:none',
    'playback-changed':
      'live(establishing) cam:off mic:off read:requesting next:none apply:none',
  },
  live: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:off mic:off read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:off mic:off read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:off mic:off read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:off mic:off read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:off mic:off read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:off mic:off read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:off mic:off read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(current) cam:off mic:off read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:off mic:off read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:off read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:off mic:off read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:none next:starting apply:none | refresh-view, capture:camera, capture:microphone, defer-read-start',
    observed: 'live(current) cam:off mic:off read:none next:none apply:none',
    'playback-changed':
      'live(current) cam:off mic:off read:none next:none apply:none',
  },
  'live publishing': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:publishing mic:capturing read:none next:none apply:running',
    'read-requested wake':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running',
    'read-requested view':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:running | defer-read-start',
    'read-requested boundary':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:publishing mic:capturing read:none next:none apply:running | schedule:recovery',
    'timer-fired capture-patience':
      'live(current) cam:publishing mic:capturing(past patience) read:none next:none apply:running',
    'browser-nudged':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(current) cam:publishing mic:capturing read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:publishing mic:capturing read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running | refresh-view',
    observed:
      'live(current) cam:publishing mic:capturing read:none next:none apply:running',
    'published camera':
      'live(current) cam:published mic:capturing read:none next:none apply:running',
    'publish-failed camera failure':
      'live(current) cam:failed mic:capturing read:none next:none apply:running | release-track:camera',
    'captured microphone':
      'live(current) cam:publishing mic:warm read:none next:none apply:running',
    'capture-failed microphone permission':
      'live(current) cam:publishing mic:failed read:none next:none apply:running',
    'capture-failed microphone absence checked':
      'live(current) cam:publishing mic:missing read:none next:none apply:running',
    'playback-changed':
      'live(current) cam:publishing mic:capturing read:none next:none apply:running',
  },
  'live capturing': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:capturing mic:capturing read:none next:none apply:running',
    'read-requested wake':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
    'read-requested view':
      'live(checking) cam:capturing mic:capturing read:none next:starting apply:running | defer-read-start',
    'read-requested boundary':
      'live(checking) cam:capturing mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:capturing mic:capturing read:none next:none apply:running | schedule:recovery',
    'timer-fired capture-patience':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'browser-nudged':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
    'retry-pressed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'mute-requested':
      'live(current) cam:capturing mic:capturing read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:capturing mic:capturing read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    observed:
      'live(current) cam:capturing mic:capturing read:none next:none apply:running',
    'captured camera':
      'live(current) cam:publishing mic:capturing read:none next:none apply:running | publish:camera',
    'capture-failed camera permission':
      'live(current) cam:failed mic:capturing read:none next:none apply:running',
    'capture-failed camera absence checked':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    'captured microphone':
      'live(current) cam:capturing mic:publishing read:none next:none apply:running | publish:microphone',
    'capture-failed microphone permission':
      'live(current) cam:capturing mic:failed read:none next:none apply:running',
    'capture-failed microphone absence checked':
      'live(current) cam:capturing mic:missing read:none next:none apply:running',
    'playback-changed':
      'live(current) cam:capturing mic:capturing read:none next:none apply:running',
  },
  'live published': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:published mic:published read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:published mic:published read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:published mic:published read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:published mic:published read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:published mic:published read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:published mic:published read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:published mic:published read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(current) cam:published mic:published read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:published mic:published read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:published(swapped) mic:published read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:published mic:published read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:published mic:unpublishing(to warm) read:none next:starting apply:none | refresh-view, unpublish:microphone, defer-read-start',
    observed:
      'live(current) cam:published mic:published read:none next:none apply:none',
    'track-ended camera':
      'live(current) cam:failed(removing) mic:published read:none next:none apply:none | release-track:camera, unpublish:camera',
    'device-swapped camera':
      'live(current) cam:published(swapped) mic:published read:none next:none apply:none',
    'track-ended microphone':
      'live(current) cam:published mic:failed(removing) read:none next:none apply:none | release-track:microphone, unpublish:microphone',
    'device-swapped microphone':
      'live(current) cam:published mic:published(swapped) read:none next:none apply:none',
    'playback-changed':
      'live(current) cam:published mic:published read:none next:none apply:none',
  },
  'live stale': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(stale-definite) cam:off mic:off read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(stale-definite) cam:off mic:off read:none next:none apply:none',
    'read-requested wake':
      'live(stale-definite) cam:off mic:off read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(stale-definite) cam:off mic:off read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(stale-definite) cam:off mic:off read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(stale-definite) cam:off mic:off read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(stale-definite) cam:off mic:off read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(stale-definite) cam:off mic:off read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(stale-definite) cam:off mic:off read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(stale-definite) cam:missing mic:off read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(stale-definite) cam:off mic:off read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(stale-definite) cam:capturing mic:capturing read:none next:starting apply:none | refresh-view, capture:camera, capture:microphone, defer-read-start',
    observed:
      'live(stale-definite) cam:off mic:off read:none next:none apply:none',
    'playback-changed':
      'live(stale-definite) cam:off mic:off read:none next:none apply:none',
  },
  'released transient': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all',
    'tab-changed unknown': 'waiting(checking) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'released(transient) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'released(transient)',
    'read-requested view': 'released(transient)',
    'read-requested boundary': 'released(transient)',
    'timer-fired recovery': 'admitting(again) | cancel:recovery, admit',
    'browser-nudged': 'admitting(again) | cancel:recovery, admit',
    'retry-pressed': 'admitting(again) | refresh-view, cancel:recovery, admit',
  },
  'released definite': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all',
    'tab-changed unknown': 'waiting(checking) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'released(definite) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'released(definite)',
    'read-requested view': 'released(definite)',
    'read-requested boundary': 'released(definite)',
    'retry-pressed': 'admitting(again) | refresh-view, cancel:recovery, admit',
  },
  'released refused': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all',
    'tab-changed unknown': 'waiting(checking) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'released(refused) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'released(refused)',
    'read-requested view': 'released(refused)',
    'read-requested boundary': 'released(refused)',
  },
  'released replaced': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all',
    'tab-changed unknown': 'waiting(checking) | cancel:all',
    'page-left': 'ended | cancel:all',
    'frozen-page-restored': 'released(replaced) | refresh-view',
    'round-ended': 'ended | cancel:all, forget-mute',
    'mute-restored': 'released(replaced)',
    'read-requested view': 'released(replaced)',
    'read-requested boundary': 'released(replaced)',
    'retry-pressed': 'admitting(again) | refresh-view, cancel:recovery, admit',
  },
  'admission pausing': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, abort-admission',
    'tab-changed unknown': 'waiting(checking) | cancel:all, abort-admission',
    'page-left': 'ended | cancel:all, abort-admission',
    'frozen-page-restored': 'admitting(again,try1,pausing) | refresh-view',
    'round-ended': 'ended | cancel:all, abort-admission, forget-mute',
    'mute-restored': 'admitting(again,try1,pausing)',
    'admission-answered': 'connecting(again) | connect',
    'admission-failed transient':
      'admitting(again,try2,pausing) | schedule:admission-retry',
    'admission-failed refused':
      'released(refused) | cancel:all, abort-admission, refresh-view',
    'read-requested view': 'admitting(again,try1,pausing)',
    'read-requested boundary': 'admitting(again,try1,pausing)',
    'timer-fired admission-retry': 'admitting(again,try1) | admit',
  },
  'rejoin admitting': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, abort-admission',
    'tab-changed unknown': 'waiting(checking) | cancel:all, abort-admission',
    'page-left': 'ended | cancel:all, abort-admission',
    'frozen-page-restored': 'admitting(again) | refresh-view',
    'round-ended': 'ended | cancel:all, abort-admission, forget-mute',
    'mute-restored': 'admitting(again)',
    'admission-answered': 'connecting(again) | connect',
    'admission-failed transient':
      'released(transient) | cancel:all, abort-admission, schedule:recovery',
    'admission-failed refused':
      'released(refused) | cancel:all, abort-admission, refresh-view',
    'read-requested view': 'admitting(again)',
    'read-requested boundary': 'admitting(again)',
  },
  'first read pausing': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(establishing) cam:off mic:off read:pausing next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none',
    'read-requested wake':
      'live(establishing) cam:off mic:off read:pausing next:wanted apply:none',
    'read-requested view':
      'live(establishing) cam:off mic:off read:none next:starting apply:none | cancel:read-retry, defer-read-start',
    'read-requested boundary':
      'live(establishing) cam:off mic:off read:none next:starting apply:none | cancel:read-retry, defer-read-start',
    'read-answered ready':
      'live(establishing) cam:capturing mic:capturing read:none next:none apply:running | capture:camera, capture:microphone, schedule:capture-patience',
    'read-answered ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'read-answered unavailable':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed transient':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none | schedule:read-retry',
    'read-failed definite':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed ending':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed refused':
      'released(refused) | cancel:all, abort-read, release-connection, refresh-view',
    'read-aborted':
      'live(establishing) cam:off mic:off read:none next:none apply:none',
    'timer-fired read-retry':
      'live(establishing) cam:off mic:off read:requesting next:none apply:none | start-read',
    'timer-fired read-budget':
      'released(transient) | cancel:all, abort-read, release-connection, schedule:recovery',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, abort-read, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none | start-audio',
    'forget-failed':
      'live(establishing) cam:missing mic:off read:pausing next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(establishing) cam:off mic:off read:pausing next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(establishing) cam:capturing mic:capturing read:pausing next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(establishing) cam:off mic:off read:pausing next:none apply:none',
    'playback-changed':
      'live(establishing) cam:off mic:off read:pausing next:none apply:none',
  },
  'read starting': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:off mic:off read:none next:starting apply:none | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:off mic:off read:none next:starting apply:none',
    'read-requested view':
      'live(checking) cam:off mic:off read:none next:starting apply:none | schedule:read-budget',
    'read-requested boundary':
      'live(checking) cam:off mic:off read:none next:starting apply:none | schedule:read-budget',
    'read-start-due':
      'live(current) cam:off mic:off read:requesting next:none apply:none | start-read',
    'browser-nudged':
      'live(current) cam:off mic:off read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:off mic:off read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(current) cam:off mic:off read:none next:starting apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:off mic:off read:none next:starting apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:off read:none next:starting apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:off mic:off read:none next:starting apply:none | refresh-view',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:none next:starting apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(current) cam:off mic:off read:none next:starting apply:none',
    'playback-changed':
      'live(current) cam:off mic:off read:none next:starting apply:none',
  },
  'read in flight, another wanted': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none',
    'read-requested view':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | abort-read, schedule:read-budget',
    'read-requested boundary':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | abort-read, schedule:read-budget',
    'read-answered ready':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | capture:camera, capture:microphone, schedule:capture-patience, schedule:read-budget',
    'read-answered ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'read-answered unavailable':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed transient':
      'live(current) cam:off mic:off read:pausing next:wanted apply:none | schedule:read-retry',
    'read-failed definite':
      'live(stale-definite) cam:off mic:off read:requesting next:none apply:none | cancel:recovery, start-read',
    'read-failed ending':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed refused':
      'released(refused) | cancel:all, abort-read, release-connection, refresh-view',
    'read-aborted':
      'live(current) cam:off mic:off read:requesting next:none apply:none | start-read',
    'browser-nudged':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none',
    'retry-pressed':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'mute-requested':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:off read:requesting next:wanted apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:requesting next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(current) cam:off mic:off read:requesting next:wanted apply:none',
    'playback-changed':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none',
  },
  'read aborting, checking': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none',
    'read-requested view':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none',
    'read-answered ready':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-answered ended':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-answered unavailable':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-failed transient':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-failed definite':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-failed ending':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-failed refused':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'read-aborted':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | start-read',
    'timer-fired read-budget':
      'live(stale-wake) cam:off mic:off read:aborting next:wanted apply:none | schedule:recovery',
    'browser-nudged':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none',
    'retry-pressed':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | refresh-view',
    'mute-requested':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | start-audio',
    'forget-failed':
      'live(checking) cam:missing mic:off read:aborting next:wanted apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(checking) cam:capturing mic:capturing read:aborting next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none',
    'playback-changed':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none',
  },
  'read letting finish': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none',
    'read-requested view':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none',
    'read-answered ready':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-answered ended':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-answered unavailable':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-failed transient':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-failed definite':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-failed ending':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-failed refused':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'read-aborted':
      'live(checking) cam:off mic:off read:requesting next:none apply:none | cancel:read-let-finish, start-read',
    'timer-fired read-budget':
      'live(stale-wake) cam:off mic:off read:letting-finish next:wanted apply:none | schedule:recovery',
    'timer-fired read-let-finish':
      'live(checking) cam:off mic:off read:aborting next:wanted apply:none | abort-read',
    'browser-nudged':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none',
    'retry-pressed':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none | refresh-view',
    'mute-requested':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none | start-audio',
    'forget-failed':
      'live(checking) cam:missing mic:off read:letting-finish next:wanted apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(checking) cam:capturing mic:capturing read:letting-finish next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none',
    'playback-changed':
      'live(checking) cam:off mic:off read:letting-finish next:wanted apply:none',
  },
  'prompt past patience': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing(past patience) read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:starting apply:none | refresh-view, defer-read-start',
    observed:
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none',
    'captured camera':
      'live(current) cam:publishing mic:capturing(past patience) read:none next:none apply:none | publish:camera',
    'capture-failed camera permission':
      'live(current) cam:failed mic:capturing(past patience) read:none next:none apply:none',
    'capture-failed camera absence checked':
      'live(current) cam:missing mic:capturing(past patience) read:none next:none apply:none',
    'captured microphone':
      'live(current) cam:capturing(past patience) mic:warm read:none next:none apply:none',
    'capture-failed microphone permission':
      'live(current) cam:capturing(past patience) mic:failed read:none next:none apply:none',
    'capture-failed microphone absence checked':
      'live(current) cam:capturing(past patience) mic:missing read:none next:none apply:none',
    'playback-changed':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:none next:none apply:none',
  },
  'answer waiting behind an apply': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:queued | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(checking) cam:publishing mic:capturing read:none next:none apply:queued',
    'read-requested wake':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:queued | defer-read-start',
    'read-requested view':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:publishing mic:capturing read:none next:none apply:queued | schedule:recovery',
    'timer-fired capture-patience':
      'live(checking) cam:publishing mic:capturing(past patience) read:none next:none apply:queued',
    'browser-nudged':
      'live(checking) cam:publishing mic:capturing read:requesting next:none apply:queued | start-read',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(checking) cam:publishing mic:capturing read:none next:none apply:queued muting | set-mute',
    'enable-sound-pressed':
      'live(checking) cam:publishing mic:capturing read:none next:none apply:queued | start-audio',
    'forget-failed':
      'live(checking) cam:missing mic:capturing read:none next:none apply:queued',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:queued | refresh-view, defer-read-start',
    'permission-changed':
      'live(checking) cam:publishing mic:capturing read:none next:starting apply:queued | refresh-view, defer-read-start',
    observed:
      'live(checking) cam:publishing mic:capturing read:none next:none apply:queued',
    'published camera':
      'live(checking) cam:published mic:capturing read:none next:none apply:queued',
    'publish-failed camera failure':
      'live(checking) cam:failed mic:capturing read:none next:none apply:queued | release-track:camera',
    'captured microphone':
      'live(checking) cam:publishing mic:warm read:none next:none apply:queued',
    'capture-failed microphone permission':
      'live(checking) cam:publishing mic:failed read:none next:none apply:queued',
    'capture-failed microphone absence checked':
      'live(checking) cam:publishing mic:missing read:none next:none apply:queued',
    'playback-changed':
      'live(checking) cam:publishing mic:capturing read:none next:none apply:queued',
  },
  'warm microphone': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:published mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:published mic:warm read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:published mic:warm read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:published mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:published mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:published mic:warm read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:published mic:warm read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(current) cam:published mic:warm read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:published mic:warm read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:published mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:published mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    observed:
      'live(current) cam:published mic:warm read:none next:none apply:none',
    'track-ended camera':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none | release-track:camera, unpublish:camera',
    'device-swapped camera':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    'playback-changed':
      'live(current) cam:published mic:warm read:none next:none apply:none',
  },
  unpublishing: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none',
    'read-requested view':
      'live(checking) cam:unpublishing mic:off read:none next:starting apply:none | schedule:read-budget',
    'read-requested boundary':
      'live(checking) cam:unpublishing mic:off read:none next:starting apply:none | schedule:read-budget',
    'read-start-due':
      'live(current) cam:unpublishing mic:off read:requesting next:none apply:none | start-read',
    'browser-nudged':
      'live(current) cam:unpublishing mic:off read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:off read:none next:starting apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none | refresh-view',
    'permission-changed':
      'live(current) cam:unpublishing mic:capturing read:none next:starting apply:none | refresh-view, capture:microphone',
    observed:
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none',
    'unpublished camera':
      'live(current) cam:off mic:off read:requesting next:none apply:none | start-read',
    'unpublish-failed camera':
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none | release-track:camera, start-read',
    'playback-changed':
      'live(current) cam:unpublishing mic:off read:none next:starting apply:none',
  },
  'failed and still removing': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:failed(removing) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:failed(removing) mic:warm read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:failed(removing) mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:failed(removing) mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:failed(removing) mic:warm read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:warm read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:failed(removing) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:failed(removing) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    observed:
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none',
    'unpublished camera':
      'live(current) cam:failed mic:warm read:none next:none apply:none',
    'unpublish-failed camera':
      'live(current) cam:stale-publication mic:warm read:none next:none apply:none | release-track:camera',
    'playback-changed':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none',
  },
  failed: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:failed mic:capturing read:none next:none apply:running',
    'read-requested wake':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running',
    'read-requested view':
      'live(checking) cam:failed mic:capturing read:none next:starting apply:running | defer-read-start',
    'read-requested boundary':
      'live(checking) cam:failed mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:failed mic:capturing read:none next:none apply:running | schedule:recovery',
    'timer-fired capture-patience':
      'live(current) cam:failed mic:capturing(past patience) read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'browser-nudged':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running',
    'retry-pressed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view, capture:camera',
    'mute-requested':
      'live(current) cam:failed mic:capturing read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:failed mic:capturing read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running | refresh-view',
    observed:
      'live(current) cam:failed mic:capturing read:none next:none apply:running',
    'captured microphone':
      'live(current) cam:failed mic:warm read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'capture-failed microphone permission':
      'live(current) cam:failed mic:failed read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'capture-failed microphone absence checked':
      'live(current) cam:failed mic:missing read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'playback-changed':
      'live(current) cam:failed mic:capturing read:none next:none apply:running',
  },
  missing: {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    'read-requested wake':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running',
    'read-requested view':
      'live(checking) cam:missing mic:capturing read:none next:starting apply:running | defer-read-start',
    'read-requested boundary':
      'live(checking) cam:missing mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:missing mic:capturing read:none next:none apply:running | schedule:recovery',
    'timer-fired capture-patience':
      'live(current) cam:missing mic:capturing(past patience) read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'browser-nudged':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running',
    'retry-pressed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view, forget-checked-devices, capture:camera',
    'mute-requested':
      'live(current) cam:missing mic:capturing read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running | refresh-view',
    observed:
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
    'captured camera':
      'live(current) cam:missing mic:capturing read:none next:none apply:running | release-track:camera',
    'captured microphone':
      'live(current) cam:missing mic:warm read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'capture-failed microphone permission':
      'live(current) cam:missing mic:failed read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'capture-failed microphone absence checked':
      'live(current) cam:missing mic:missing read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'playback-changed':
      'live(current) cam:missing mic:capturing read:none next:none apply:running',
  },
  'stale publication': {
    'tab-changed false':
      'waiting(elsewhere) | cancel:all, abort-read, release-connection',
    'tab-changed unknown':
      'waiting(checking) | cancel:all, abort-read, release-connection',
    'page-left': 'ended | cancel:all, abort-read, release-connection',
    'frozen-page-restored':
      'live(current) cam:stale-publication mic:off read:requesting next:wanted apply:none | refresh-view',
    'round-ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none',
    'read-requested wake':
      'live(current) cam:stale-publication mic:off read:requesting next:wanted apply:none',
    'read-requested view':
      'live(checking) cam:stale-publication mic:off read:aborting next:wanted apply:none | abort-read, schedule:read-budget',
    'read-requested boundary':
      'live(checking) cam:stale-publication mic:off read:aborting next:wanted apply:none | abort-read, schedule:read-budget',
    'read-answered ready':
      'live(current) cam:stale-publication mic:off read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'read-answered ended':
      'ended | cancel:all, abort-read, release-connection, forget-mute',
    'read-answered unavailable':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed transient':
      'live(current) cam:stale-publication mic:off read:pausing next:none apply:none | schedule:read-retry',
    'read-failed definite':
      'live(stale-definite) cam:stale-publication mic:off read:none next:none apply:none | cancel:recovery',
    'read-failed ending':
      'released(definite) | cancel:all, abort-read, release-connection, refresh-view',
    'read-failed refused':
      'released(refused) | cancel:all, abort-read, release-connection, refresh-view',
    'read-aborted':
      'live(current) cam:stale-publication mic:off read:none next:none apply:none',
    'browser-nudged':
      'live(current) cam:stale-publication mic:off read:requesting next:wanted apply:none',
    'retry-pressed':
      'live(current) cam:off mic:off read:requesting next:wanted apply:none | refresh-view',
    'mute-requested':
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:off read:requesting next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, abort-read, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, abort-read, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:stale-publication mic:off read:requesting next:wanted apply:none | refresh-view',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:requesting next:wanted apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none',
    'playback-changed':
      'live(current) cam:stale-publication mic:off read:requesting next:none apply:none',
  },
  'published on a swapped device': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:published(swapped) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    'read-requested wake':
      'live(current) cam:published(swapped) mic:warm read:none next:starting apply:none | defer-read-start',
    'read-requested view':
      'live(checking) cam:published(swapped) mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:published(swapped) mic:warm read:none next:starting apply:none | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:published(swapped) mic:warm read:requesting next:none apply:none | start-read',
    'retry-pressed':
      'live(current) cam:published mic:warm read:requesting next:none apply:none | refresh-view, forget-checked-devices, start-read',
    'mute-requested':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none | start-audio',
    'forget-failed':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:published(swapped) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:published(swapped) mic:warm read:none next:starting apply:none | refresh-view, defer-read-start',
    observed:
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    'track-ended camera':
      'live(current) cam:failed(removing) mic:warm read:none next:none apply:none | release-track:camera, unpublish:camera',
    'device-swapped camera':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
    'playback-changed':
      'live(current) cam:published(swapped) mic:warm read:none next:none apply:none',
  },
  'mute in flight': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:off mic:published read:none next:starting apply:none muting | refresh-view, defer-read-start',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:off mic:published read:none next:none apply:none muting',
    'read-requested wake':
      'live(current) cam:off mic:published read:none next:starting apply:none muting | defer-read-start',
    'read-requested view':
      'live(checking) cam:off mic:published read:none next:starting apply:none muting | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(checking) cam:off mic:published read:none next:starting apply:none muting | schedule:read-budget, defer-read-start',
    'browser-nudged':
      'live(current) cam:off mic:published read:requesting next:none apply:none muting | start-read',
    'retry-pressed':
      'live(current) cam:off mic:published read:requesting next:none apply:none muting | refresh-view, start-read',
    'enable-sound-pressed':
      'live(current) cam:off mic:published read:none next:none apply:none muting | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:published read:none next:none apply:none muting',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:off mic:published read:none next:starting apply:none muting | refresh-view, defer-read-start',
    'permission-changed':
      'live(current) cam:capturing mic:unpublishing(to warm) read:none next:starting apply:none muting | refresh-view, capture:camera, unpublish:microphone, defer-read-start',
    observed:
      'live(current) cam:off mic:published read:none next:none apply:none muting',
    'track-ended microphone':
      'live(current) cam:off mic:failed(removing) read:none next:none apply:none muting | release-track:microphone, unpublish:microphone',
    'device-swapped microphone':
      'live(current) cam:off mic:published(swapped) read:none next:none apply:none muting',
    'mute-applied':
      'live(current) cam:off mic:published read:none next:none apply:none | remember-mute',
    'mute-abandoned':
      'live(current) cam:off mic:published read:none next:none apply:none',
    'mute-failed failure':
      'live(current) cam:off mic:failed(removing) read:none next:none apply:none | release-track:microphone, unpublish:microphone',
    'playback-changed':
      'live(current) cam:off mic:published read:none next:none apply:none muting',
  },
  'stale, its wake waiting': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none',
    'read-requested view':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none | schedule:read-budget',
    'read-start-due':
      'live(stale-wake) cam:off mic:off read:requesting next:none apply:none | start-read',
    'timer-fired recovery':
      'live(stale) cam:off mic:off read:requesting next:none apply:none | cancel:recovery, start-read',
    'browser-nudged':
      'live(stale) cam:off mic:off read:requesting next:none apply:none | cancel:recovery, start-read',
    'retry-pressed':
      'live(stale-wake) cam:off mic:off read:requesting next:none apply:none | refresh-view, start-read',
    'mute-requested':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none muting | set-mute',
    'enable-sound-pressed':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none | start-audio',
    'forget-failed':
      'live(stale-wake) cam:missing mic:off read:none next:starting apply:none',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none | refresh-view',
    'permission-changed':
      'live(stale-wake) cam:capturing mic:capturing read:none next:starting apply:none | refresh-view, capture:camera, capture:microphone',
    observed:
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none',
    'playback-changed':
      'live(stale-wake) cam:off mic:off read:none next:starting apply:none',
  },
  'defaults chosen': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
    'read-requested view':
      'live(checking) cam:capturing mic:capturing read:none next:starting apply:running | defer-read-start',
    'read-requested boundary':
      'live(checking) cam:capturing mic:capturing read:none next:starting apply:running | defer-read-start',
    'timer-fired read-budget':
      'live(stale-wake) cam:capturing mic:capturing read:none next:wanted apply:running | schedule:recovery',
    'timer-fired capture-patience':
      'live(current) cam:capturing(past patience) mic:capturing(past patience) read:requesting next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery, start-read',
    'browser-nudged':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
    'retry-pressed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'mute-requested':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | start-audio',
    'forget-failed':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running | refresh-view',
    observed:
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
    'captured camera':
      'live(current) cam:publishing mic:capturing read:none next:wanted apply:running | publish:camera',
    'capture-failed camera permission':
      'live(current) cam:failed mic:capturing read:none next:wanted apply:running',
    'capture-failed camera absence checked':
      'live(current) cam:missing mic:capturing read:none next:wanted apply:running',
    'captured microphone':
      'live(current) cam:capturing mic:warm read:none next:wanted apply:running',
    'capture-failed microphone permission':
      'live(current) cam:capturing mic:failed read:none next:wanted apply:running',
    'capture-failed microphone absence checked':
      'live(current) cam:capturing mic:missing read:none next:wanted apply:running',
    'playback-changed':
      'live(current) cam:capturing mic:capturing read:none next:wanted apply:running',
  },
  'stuck publish beside a live microphone': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(stale-wake) cam:publishing mic:published read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running',
    'read-requested wake':
      'live(stale-wake) cam:publishing mic:published read:none next:wanted apply:running',
    'read-requested view':
      'live(stale-wake) cam:publishing mic:published read:none next:starting apply:running | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(stale-wake) cam:publishing mic:published read:none next:starting apply:running | schedule:read-budget, defer-read-start',
    'timer-fired capture-patience':
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running | schedule:read-budget',
    'timer-fired recovery':
      'live(stale-wake) cam:publishing(stuck) mic:published read:none next:none apply:running | schedule:recovery',
    'browser-nudged':
      'live(stale-wake) cam:publishing(stuck) mic:published read:none next:none apply:running | schedule:recovery',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(stale-wake) cam:missing mic:published read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(stale-wake) cam:publishing mic:published read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(stale-wake) cam:publishing mic:unpublishing(to warm) read:none next:wanted apply:running | refresh-view, unpublish:microphone',
    observed:
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running',
    'published camera':
      'live(current) cam:published mic:published read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'publish-failed camera failure':
      'live(current) cam:failed mic:published read:none next:none apply:none | release-track:camera, cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'track-ended microphone':
      'live(stale-wake) cam:publishing mic:failed(removing) read:none next:none apply:running | release-track:microphone, unpublish:microphone, schedule:read-budget',
    'device-swapped microphone':
      'live(stale-wake) cam:publishing mic:published(swapped) read:none next:none apply:running | schedule:read-budget',
    'playback-changed':
      'live(stale-wake) cam:publishing mic:published read:none next:none apply:running',
  },
  'stuck publish with nothing healthy': {
    'tab-changed false': 'waiting(elsewhere) | cancel:all, release-connection',
    'tab-changed unknown': 'waiting(checking) | cancel:all, release-connection',
    'page-left': 'ended | cancel:all, release-connection',
    'frozen-page-restored':
      'live(stale-wake) cam:publishing mic:failed read:none next:wanted apply:running | refresh-view',
    'round-ended': 'ended | cancel:all, release-connection, forget-mute',
    'mute-restored':
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running',
    'read-requested wake':
      'live(stale-wake) cam:publishing mic:failed read:none next:wanted apply:running',
    'read-requested view':
      'live(stale-wake) cam:publishing mic:failed read:none next:starting apply:running | schedule:read-budget, defer-read-start',
    'read-requested boundary':
      'live(stale-wake) cam:publishing mic:failed read:none next:starting apply:running | schedule:read-budget, defer-read-start',
    'timer-fired capture-patience':
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running | schedule:read-budget',
    'timer-fired recovery':
      'admitting(again) | cancel:all, release-connection, cancel:recovery, admit',
    'browser-nudged':
      'admitting(again) | cancel:all, release-connection, cancel:recovery, admit',
    'retry-pressed':
      'admitting(again) | refresh-view, cancel:all, release-connection, cancel:recovery, admit',
    'mute-requested':
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running muting | set-mute',
    'enable-sound-pressed':
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running | start-audio',
    'forget-failed':
      'live(stale-wake) cam:missing mic:failed read:none next:none apply:running',
    dropped:
      'released(transient) | refresh-view, cancel:all, release-connection, schedule:recovery',
    replaced:
      'released(replaced) | cancel:all, release-connection, refresh-view',
    'room-changed':
      'live(stale-wake) cam:publishing mic:failed read:none next:wanted apply:running | refresh-view',
    'permission-changed':
      'live(stale-wake) cam:publishing mic:failed read:none next:wanted apply:running | refresh-view',
    observed:
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running',
    'published camera':
      'live(current) cam:published mic:failed read:none next:none apply:none | cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'publish-failed camera failure':
      'live(current) cam:failed mic:failed read:none next:none apply:none | release-track:camera, cancel:capture-patience, cancel:read-budget, cancel:recovery',
    'playback-changed':
      'live(stale-wake) cam:publishing mic:failed read:none next:none apply:running',
  },
  ended: {},
};
