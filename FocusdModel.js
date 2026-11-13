// Pure helpers for OmaPomodorchy (fork of bibek.focusd). No QML, no I/O —
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

// ---- Rounds before stop (Phase 4) ----
// A run is a sequence of work sessions. `rounds` (0 = off, unlimited) is
// how many work sessions run before the timer stops. The count is
// in-memory: it resets when a run completes or the daemon restarts.

// Rounds, clamped to 0 (off) .. 12. Null when the value is not a number.
function clampRounds(value) {
  var n = Number(value)
  if (!isFinite(n)) return null
  return Math.max(0, Math.min(12, Math.round(n)))
}

// True when a work session ended into a break — the same edge as the
// chime, restricted to work. A skipped work session counts (the chime
// treats a skip as a session change too).
function workSessionEnded(prevSession, prevStatus, nextSession) {
  return sessionEnded(prevSession, prevStatus, nextSession) && prevSession === "work" && isBreakSession(nextSession)
}

// True when the run has reached its round limit (rounds 0 means off).
function shouldStopAfterRound(rounds, roundsCompleted) {
  return rounds > 0 && roundsCompleted >= rounds
}

// Launch the Breather once per break, on the first poll where the break is
// running. launchedFor is the session key the Breather already launched for
// ("" if none this break). A break that starts paused does not launch until
// the user resumes it, and pause/resume mid-break does not relaunch. minutes
// is the break's remaining time in whole minutes; 0 means unknown, so no
// launch. An empty breakPattern turns the link off.
function shouldLaunchBreather(sessionKey, status, launchedFor, breakPattern, minutes) {
  if (!breakPattern) return false
  if (!isBreakSession(sessionKey)) return false
  if (status !== "running") return false
  if (launchedFor === sessionKey) return false
  if (minutes <= 0) return false
  return true
}
// ---- Block tagging (Phase 5) ----
// Each work block gets a category, picked in advance (the picker sets the
// tag for the next/current work block) or afterwards (the panel's Last row
// cycles the tag of the block that just ended). Tags are a setting in
// ~/.config/omarchy/focusd.json: "tags": ["Work", "Study", "Art", ...].
// Completed work blocks are recorded in ~/.config/omarchy/
// focusd-sessions.json, one entry per block: { date, tag, minutes }.
// That file is the source Phase 6 exports to the Obsidian log.

// The default category list, used when the `tags` setting is missing,
// empty, or not a list of strings.
var DEFAULT_TAGS = ["Work", "Study", "Art", "Admin", "Other"]

// Normalize the `tags` setting: an array of non-empty strings, trimmed
// and de-duplicated. A single string is one tag. Anything else (missing,
// empty, not a string/array) falls back to the defaults.
function parseTags(value) {
  var list = []
  if (typeof value === "string") {
    list = [value]
  } else if (Array.isArray(value)) {
    list = value
  } else {
    return DEFAULT_TAGS.slice()
  }
  var out = []
  for (var i = 0; i < list.length; i++) {
    var t = String(list[i] || "").trim()
    if (t && out.indexOf(t) === -1) out.push(t)
  }
  return out.length ? out : DEFAULT_TAGS.slice()
}

// Total seconds in a "MM:SS" or "H:MM:SS" remaining-time string. 0 when
// the text is not a time. (parseMinutes floors to whole minutes for the
// Breather; this one keeps the seconds, for measuring a block's length.)
function parseSeconds(text) {
  var parts = String(text || "").trim().split(":")
  if (parts.length < 2 || parts.length > 3) return 0
  var secs = 0
  for (var i = 0; i < parts.length; i++) {
    var n = Number(parts[i])
    if (!isFinite(n) || n < 0) return 0
    secs = secs * 60 + n
  }
  return secs
}

// Minutes actually spent in the work block that just ended: the
// configured work length minus what was still on the clock at the last
// poll before it ended. A block that ran out is the full length; a
// skipped block is the elapsed part. Unknown remaining time (no previous
// poll) is the full length. Clamped to 1..workMinutes.
function elapsedMinutes(workMinutes, prevRemainingSecs) {
  var w = Number(workMinutes)
  if (!isFinite(w) || w <= 0) return 0
  var remaining = Number(prevRemainingSecs)
  if (!isFinite(remaining) || remaining <= 0) return Math.round(w)
  var elapsed = Math.round((w * 60 - remaining) / 60)
  return Math.max(1, Math.min(Math.round(w), elapsed))
}

// The session log: a JSON array of { date, tag, minutes } entries, one
// per completed work block. Invalid or empty text is an empty log — a
// corrupted file is replaced with a fresh one on the next block, rather
// than blocking logging forever. Entries missing a field are dropped.
function parseSessionLog(text) {
  var raw = String(text || "").trim()
  if (!raw) return []
  var parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return []
  }
  if (!Array.isArray(parsed)) return []
  var out = []
  for (var i = 0; i < parsed.length; i++) {
    var e = parsed[i]
    if (!e || typeof e !== "object") continue
    var date = String(e.date || "")
    var tag = String(e.tag || "")
    var minutes = Number(e.minutes)
    if (!date || !tag || !isFinite(minutes) || minutes <= 0) continue
    out.push({ date: date, tag: tag, minutes: Math.round(minutes) })
  }
  return out
}

// Append one block to the log text and return the new JSON, compact (one
// line) so the file stays small — pretty-printing costs ~70 bytes an
// entry and the read is capped, so compact buys years of headroom. An
// invalid entry leaves the log unchanged; an invalid existing file is
// replaced with a fresh log containing just this entry.
function appendSessionLog(text, entry) {
  var log = parseSessionLog(text)
  var date = String((entry && entry.date) || "")
  var tag = String((entry && entry.tag) || "")
  var minutes = Number(entry && entry.minutes)
  if (!date || !tag || !isFinite(minutes) || minutes <= 0) return JSON.stringify(log)
  log.push({ date: date, tag: tag, minutes: Math.round(minutes) })
  return JSON.stringify(log)
}

// Change the tag of the most recent block in the log. Returns the new
// JSON, or null when there is no block to retag (empty or invalid log).
function retagSessionLog(text, tag) {
  var log = parseSessionLog(text)
  if (!log.length) return null
  log[log.length - 1].tag = String(tag || "")
  return JSON.stringify(log)
}

// The next tag after the current one in the list, wrapping around. Used
// by the Last row to cycle a finished block's tag. An unknown current tag
// (or an empty list) starts at the first tag.
function nextTag(tags, currentTag) {
  var list = Array.isArray(tags) ? tags : []
  if (!list.length) return ""
  var idx = list.indexOf(currentTag)
  return list[(idx + 1) % list.length]
}


// ---- Rounds setting (GUI) ----
// Set one key in a JSON settings file. Parses the text (an empty or
// invalid file starts fresh with just this key) and returns the JSON,
// 2-space indented so a hand-edited file stays readable. All other
// keys are kept as-is. Used by the panel's Rounds slider to write the
// `rounds` limit back to focusd.json.
function setJsonKey(text, key, value) {
  var obj = {}
  var raw = String(text || "").trim()
  if (raw) {
    try { obj = JSON.parse(raw) || {} } catch (e) { obj = {} }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {}
  obj[String(key)] = value
  return JSON.stringify(obj, null, 2) + "\n"
}

// ---- Config write guard ----
// True when a focusd.json text is safe to write back from: empty (no
// file yet, nothing to lose) or a valid JSON object. An invalid file,
// or a valid JSON value that is not an object, parses to {} — writing
// from that would wipe the other keys (sounds, breakPattern, tags...).
// The Service sets its configOk flag from this after each read, and
// writeRounds refuses to write while it is false.
function configTextOk(text) {
  var raw = String(text || "").trim()
  if (!raw) return true
  try {
    var parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
  } catch (e) {
    return false
  }
}

// ---- Obsidian sync (Phase 6) ----
// The vault Focus Log is a generated markdown table, one row per
// completed work block. The WHOLE table is regenerated from the sessions
// log on every write (never appended to) — so a retag in the panel
// updates the vault row too, instead of leaving a stale row behind.
// The note says it is generated, so nobody hand-edits rows that the
// next block would overwrite.
var FOCUS_LOG_HEADER = "# Focus Log\n\nSessions logged by OmaPomodorchy — one row per completed work block. This note is generated from ~/.config/omarchy/focusd-sessions.json; change a block's tag in the panel's Last row, not by editing this table.\n\n| Date | Tag | Minutes |\n| --- | --- | --- |"

// Build the full Focus Log note text from the sessions log text. Tags
// are scrubbed of pipes and newlines so a tag can never break the
// table. An empty or invalid log is just the header (no rows).
function focusLogText(text) {
  var log = parseSessionLog(text)
  var out = [FOCUS_LOG_HEADER]
  for (var i = 0; i < log.length; i++) {
    var e = log[i]
    var tag = String(e.tag || "").replace(/[|\n\r]/g, "/")
    out.push("| " + e.date + " | " + tag + " | " + e.minutes + " |")
  }
  return out.join("\n") + "\n"
}

// The argv for writing the Focus Log to the vault: create the parent
// folder if it is missing, then atomically replace the note with the
// new table (write-config --create). Paths and content travel as
// positional arguments, quoted in the script, so a path with spaces or
// a table with quotes is data, never syntax. Returns null when the log
// path is not an absolute path (an empty path disables the sync).
// Overwrite guard: an existing file is only replaced when it starts
// with the generated header — a hand-written note at that path is left
// alone, and the write is skipped silently. The marker is
// name-independent ("This note is generated from", present in every
// generated header), with the pre-rename string ("Sessions logged by
// OmoPomodorachy") as a fallback, so a Focus Log written before the
// rename is still recognised as generated and gets rewritten rather
// than silently never updating.
function focusLogCommand(writeScriptPath, focusLogPath, tableText) {
  var path = String(focusLogPath || "")
  if (!path || path.charAt(0) !== "/") return null
  return ["sh", "-c",
    'mkdir -p "$(dirname "$1")" && if [ -e "$1" ] && ! head -n 3 "$1" | grep -qE "This note is generated from|Sessions logged by OmoPomodorachy"; then exit 0; fi && exec bash "$2" --create "$1" "$3"',
    "sh", path, String(writeScriptPath || ""), String(tableText || "")]
}
