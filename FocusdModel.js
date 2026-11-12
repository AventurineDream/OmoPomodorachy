// Pure helpers for OmoPomodorachy (fork of bibek.focusd). No QML, no I/O —
// everything here is unit-tested by test/FocusdModel.test.js, and the
// service (Service.qml) only calls these, never re-implements them.

// ---- A session ending ---------------------------------------------------
// The service polls `focusd status` once a second, so a session ending is
// a session change out of a session that was running. This is the shared
// edge the chime and the Breather link both fire on.

// True when a session that was actually running ended: the session changed
// AND the previous poll had it running. The next session's status is
// deliberately not an input — a session that ran out ends whether the next
// one starts running or paused. A stop leaves the previous status paused,
// so a manual start afterwards is not an ending; a daemon restart resets
// the timer to Work while the service's stopped branches clear the
// previous session, so that is not an ending either. An empty previous
// session means "no previous poll yet" (or the timer was stopped) — the
// first thing the timer reports is not a session ending.
function sessionEnded(prevSession, prevStatus, nextSession) {
  if (!prevSession || !nextSession) return false
  if (prevSession === nextSession) return false
  if (prevStatus !== "running") return false
  return true
}

// ---- Session-end chime --------------------------------------------------
// A chime when one session ends and the next begins. Pause and resume
// never change the session, so they never chime; stopping leaves the
// session as it was, so it never chimes either.

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

// Should this poll chime? soundsEnabled gates the chime; the ending
// itself is sessionEnded above.
function shouldChime(prevSession, prevStatus, nextSession, soundsEnabled) {
  if (!soundsEnabled) return false
  return sessionEnded(prevSession, prevStatus, nextSession)
}

// ---- Terminal-Breather link ---------------------------------------------
// When a break starts, the Breather overlay opens with her chosen pattern,
// for the break's remaining time. The link is a setting (breakPattern);
// an empty pattern turns it off.

// True for the two break sessions; work is not a break.
function isBreakSession(sessionKey) {
  return sessionKey === "short-break" || sessionKey === "long-break"
}

// Argv for summoning the Breather overlay with a pattern and a length in
// minutes. The payload is one JSON argument to `omarchy-shell shell
// summon`, built with JSON.stringify so the pattern name is data, never
// syntax — a pattern name containing quotes or spaces cannot break out of
// it. A missing Breather plugin makes the summon a silent no-op.
function breatherCommand(pattern, minutes) {
  return [
    "omarchy-shell", "shell", "summon", "luotao.zen",
    JSON.stringify({ pattern: pattern, minutes: minutes })
  ]
}

// The break's remaining time, from the status text ("MM:SS", or "H:MM:SS"
// for long ones), rounded up to whole minutes so the Breather covers the
// rest of the break. Returns 0 when the text is not a time at all.
function parseMinutes(text) {
  var parts = String(text || "").trim().split(":")
  if (parts.length < 2 || parts.length > 3) return 0
  var secs = 0
  for (var i = 0; i < parts.length; i++) {
    var n = Number(parts[i])
    if (!isFinite(n) || n < 0) return 0
    secs = secs * 60 + n
  }
  if (secs <= 0) return 0
  return Math.max(1, Math.ceil(secs / 60))
}
