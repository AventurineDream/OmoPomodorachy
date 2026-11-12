// Pure helpers for OmoPomodorachy (fork of bibek.focusd). No QML, no I/O —
// everything here is unit-tested by test/FocusdModel.test.js, and the
// service (Service.qml) only calls these, never re-implements them.

// ---- Session-end chime --------------------------------------------------
// A chime when one session ends and the next begins. The service polls
// `focusd status` once a second, so a session change is the session-end
// event: the previous session ran out (or was skipped) and the next one
// started. Pause and resume never change the session, so they never chime;
// stopping leaves the session as it was, so it never chimes either.

// A bare filename is resolved into the freedesktop sound theme; a path
// (anything containing a slash) is used as-is.
var FREEDESKTOP_SOUNDS = "/usr/share/sounds/freedesktop/stereo/"
var DEFAULT_SOUND = "complete.oga"

function resolveSoundFile(name) {
  var n = String(name || "").trim()
  if (!n) n = DEFAULT_SOUND
  if (n.indexOf("/") !== -1) return n
  return FREEDESKTOP_SOUNDS + n
}

// Argv for playing one sound file. The path travels as a positional arg
// so it is data to the shell, never syntax. A missing file, or a machine
// with no player, exits silently — a chime must never break the timer.
function chimeCommand(soundFile) {
  return [
    "sh", "-c",
    'f="$1"; [ -f "$f" ] || exit 0; ' +
    'if command -v pw-play >/dev/null 2>&1; then exec pw-play "$f"; ' +
    'elif command -v paplay >/dev/null 2>&1; then exec paplay "$f"; fi',
    "sh", soundFile
  ]
}

// Should this poll chime? prevSession/prevStatus are the session key and
// status ("running", "paused") from the previous poll; nextSession is this
// poll's session key. A chime means a session that was actually running
// ended: the session changed AND the previous poll had it running. The
// next session's status is deliberately not an input — a session that ran
// out chimes whether the next one starts running or paused. A stop leaves
// the previous status paused, so a manual start afterwards never chimes;
// a daemon restart resets the timer to Work while the service's stopped
// branches clear the previous session, so that never chimes either. An
// empty previous session means "no previous poll yet" (or the timer was
// stopped), which never chimes — the first thing the timer reports is not
// a session ending.
function shouldChime(prevSession, prevStatus, nextSession, soundsEnabled) {
  if (!soundsEnabled) return false
  if (!prevSession || !nextSession) return false
  if (prevSession === nextSession) return false
  if (prevStatus !== "running") return false
  return true
}
