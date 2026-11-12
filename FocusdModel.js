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
// for long ones), rounded DOWN to whole minutes so the Breather ends a
// little before the break — ending early is gentler than the fullscreen
// overlay sitting on top of the next work session. Minimum 1; 0 when the
// text is not a time at all.
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
  return Math.max(1, Math.floor(secs / 60))
}

// ---- Variable timer lengths (Phase 3) ----
// Durations live in focusd's config.toml, under the active preset:
//   active_preset = "pomodoro"
//   [presets.pomodoro]
//   work_minutes = 25
//   short_break_minutes = 5
//   long_break_minutes = 15
// focusd re-reads the TOML when a session starts, so a change takes
// effect from the NEXT session of that type, never mid-session.

// Slider ranges, in minutes.
var DURATION_LIMITS = { work: [5, 90], shortBreak: [1, 30], longBreak: [5, 60] }

function clampDuration(kind, value) {
  var limits = DURATION_LIMITS[kind]
  if (!limits) return null
  var n = Number(value)
  if (!isFinite(n)) return null
  return Math.max(limits[0], Math.min(limits[1], Math.round(n)))
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The body span of the active preset's [presets.<name>] section in the
// TOML text: { start, end } (the text between the header line and the
// next section header, or end of file). Null when the section is missing.
function presetSection(tomlText, preset) {
  var text = String(tomlText || "")
  var headerRe = new RegExp("^\\[presets\\." + escapeRegExp(preset) + "\\][ \\t]*$", "m")
  var headerMatch = headerRe.exec(text)
  if (!headerMatch) return null
  var start = headerMatch.index + headerMatch[0].length
  var rest = text.slice(start)
  var nextHeader = rest.search(/^\[/m)
  var end = nextHeader === -1 ? text.length : start + nextHeader
  return { start: start, end: end }
}

// The active preset's durations, from the focusd config TOML text.
// Returns { preset, work, shortBreak, longBreak } or null when the file
// is missing the active preset or any of its three durations.
function parseDurations(tomlText) {
  var text = String(tomlText || "")
  var presetMatch = text.match(/^[ \t]*active_preset[ \t]*=[ \t]*"([^"\n]+)"/m)
  if (!presetMatch) return null
  var preset = presetMatch[1]
  var section = presetSection(text, preset)
  if (!section) return null
  var body = text.slice(section.start, section.end)
  function minutesFor(key) {
    var m = body.match(new RegExp("^[ \\t]*" + key + "[ \\t]*=[ \\t]*([0-9]+)[ \\t]*(?:#.*)?$", "m"))
    return m ? Number(m[1]) : null
  }
  var work = minutesFor("work_minutes")
  var shortBreak = minutesFor("short_break_minutes")
  var longBreak = minutesFor("long_break_minutes")
  if (work === null || shortBreak === null || longBreak === null) return null
  return { preset: preset, work: work, shortBreak: shortBreak, longBreak: longBreak }
}

// Rewrite one duration in the active preset's section of the TOML text,
// keeping everything else byte-for-byte (comments, order, the other
// presets). Only the given key is touched, and only when its desired value
// differs from the file's current value for it. This is what makes a
// slider safe against a change made in the Focusd TUI to a different key:
// the other sliders still hold their (now stale) values, but those values
// are never passed in, so they are never written back. A preset value
// outside the slider range (a 120-minute deep-work block, a 2-minute long
// break) is left alone until she actually moves that slider. A rewritten
// value is clamped to its slider range. Returns the updated text (the
// input unchanged when the value already matches), or null when the active
// preset or the duration key is missing, the kind is unknown, or the value
// is not a number — so the caller never writes a broken file.
function updateDuration(tomlText, kind, value) {
  var text = String(tomlText || "")
  var parsed = parseDurations(text)
  if (!parsed) return null
  var keyMap = { work: "work_minutes", shortBreak: "short_break_minutes", longBreak: "long_break_minutes" }
  var key = keyMap[kind]
  if (!key) return null
  var desired = Number(value)
  if (!isFinite(desired)) return null
  if (desired === parsed[kind]) return text
  var clamped = clampDuration(kind, desired)
  if (clamped === null) return null
  var section = presetSection(text, parsed.preset)
  if (!section) return null
  var body = text.slice(section.start, section.end)
  var re = new RegExp("^(\\s*" + key + "\\s*=\\s*)[0-9]+", "m")
  var matched = false
  body = body.replace(re, function (m, p1) { matched = true; return p1 + clamped })
  if (!matched) return null
  return text.slice(0, section.start) + body + text.slice(section.end)
}
// on the first poll where the break is running. launchedFor is the session
// key the Breather already launched for ("" if none this break). A break
// that starts paused does not launch until the user resumes it, and
// pause/resume mid-break does not relaunch. minutes is the break's
// remaining time in whole minutes; 0 means unknown, so no launch. An
// empty breakPattern turns the link off.
function shouldLaunchBreather(sessionKey, status, launchedFor, breakPattern, minutes) {
  if (!breakPattern) return false
  if (!isBreakSession(sessionKey)) return false
  if (status !== "running") return false
  if (launchedFor === sessionKey) return false
  if (minutes <= 0) return false
  return true
}
