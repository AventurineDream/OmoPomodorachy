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
    "omarchy-shell", "shell", "summon", "aven.terminal-breather",
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

// ---- Presets: list, switch, save as ----
// The preset names in the TOML, in file order (pomodoro first — it is
// the first [presets.*] section in the stock config). Empty when the
// file has no preset sections.
function listPresets(tomlText) {
  var text = String(tomlText || "")
  var out = []
  var re = /^\[presets\.([A-Za-z0-9_-]+)\][ \t]*$/gm
  var m
  while ((m = re.exec(text)) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1])
  }
  return out
}

// Switch the active preset. Returns the updated TOML, or null when the
// name is not one of the file's presets. The durations come from the
// TOML on the next poll; nothing else is touched.
function setActivePreset(tomlText, name) {
  var text = String(tomlText || "")
  var presets = listPresets(text)
  if (presets.indexOf(String(name)) === -1) return null
  var re = /^([ \t]*active_preset[ \t]*=[ \t]*)"[^"\n]*"/m
  if (!re.test(text)) return null
  return text.replace(re, function (m, p1) { return p1 + '"' + String(name) + '"' })
}

// A preset name is a bare TOML key: letters, digits, underscore and
// hyphen, starting with a letter or underscore, no spaces. Null when
// the name is not usable as a [presets.<name>] section.
function validPresetName(name) {
  var n = String(name || "").trim()
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(n) ? n : null
}

// Save the given durations as a preset (new or existing) and make it
// active. sessions_before_long_break is inherited from the active
// preset (4 when it has none). Returns the updated TOML, or null on a
// bad name or an unparseable file.
function savePresetAs(tomlText, name, work, shortBreak, longBreak) {
  var text = String(tomlText || "")
  var valid = validPresetName(name)
  if (!valid) return null
  var parsed = parseDurations(text)
  if (!parsed) return null
  var w = clampDuration("work", work)
  var s = clampDuration("shortBreak", shortBreak)
  var l = clampDuration("longBreak", longBreak)
  if (w === null || s === null || l === null) return null
  // sessions_before_long_break rides along from the active preset.
  var activeBody = ""
  var activeSection = presetSection(text, parsed.preset)
  if (activeSection) activeBody = text.slice(activeSection.start, activeSection.end)
  var sbl = activeBody.match(/^[ \t]*sessions_before_long_break[ \t]*=[ \t]*([0-9]+)/m)
  var sessions = sbl ? Number(sbl[1]) : 4
  var sectionText = "[presets." + valid + "]\nwork_minutes = " + w + "\nshort_break_minutes = " + s + "\nlong_break_minutes = " + l + "\nsessions_before_long_break = " + sessions + "\n"
  var section = presetSection(text, valid)
  if (section) {
    // Replace the existing section's body, keeping any surrounding
    // comments and the sessions_before_long_break line if present.
    var body = text.slice(section.start, section.end)
    function setKey(b, key, value) {
      var re = new RegExp("^(\\s*" + key + "\\s*=\\s*)[0-9]+", "m")
      if (re.test(b)) return b.replace(re, function (m, p1) { return p1 + value })
      return b.replace(/\s*$/, "\n" + key + " = " + value + "\n")
    }
    body = setKey(body, "work_minutes", w)
    body = setKey(body, "short_break_minutes", s)
    body = setKey(body, "long_break_minutes", l)
    if (!/sessions_before_long_break/.test(body))
      body = body.replace(/\s*$/, "\nsessions_before_long_break = " + sessions + "\n")
    text = text.slice(0, section.start) + body + text.slice(section.end)
  } else {
    if (text.length && text.charAt(text.length - 1) !== "\n") text += "\n"
    text += "\n" + sectionText
  }
  return setActivePreset(text, valid)
}

// ---- Tags: add and remove ----
// Add a tag to the category list. The name is trimmed; an empty name, a
// duplicate, or a name with a pipe or newline is rejected (a pipe would
// break the Focus Log table). Returns the new list, or null.
function addTag(tags, name) {
  var list = parseTags(tags)
  var n = String(name || "").trim()
  if (!n || n.indexOf("|") !== -1 || n.indexOf("\n") !== -1 || n.indexOf("\r") !== -1) return null
  if (list.indexOf(n) !== -1) return null
  return list.concat([n])
}

// Remove a tag from the category list. Returns the new list, or null
// when the tag is not there or removing it would leave no tags at all.
function removeTag(tags, name) {
  var list = parseTags(tags)
  var idx = list.indexOf(String(name))
  if (idx === -1) return null
  if (list.length <= 1) return null
  list.splice(idx, 1)
  return list
}

// ---- Tag schedule: queue tags for upcoming blocks, save as presets ----
// A schedule is an ordered queue of tags for upcoming work blocks. When
// a block ends, the next tag is taken from the front of the queue and
// becomes the current tag for the block after it. The queue lives in
// focusd.json under `tagSchedule`; named presets live under
// `tagSchedulePresets` (name -> tag array).

// Append a tag to the schedule queue. The tag must be one of the known
// categories. Returns the new queue, or null.
function enqueueTag(schedule, tag, tags) {
  var known = parseTags(tags)
  var t = String(tag || "").trim()
  if (known.indexOf(t) === -1) return null
  var q = Array.isArray(schedule) ? schedule.slice() : []
  q.push(t)
  return q
}

// Remove the queued tag at index. Returns the new queue, or null.
function removeScheduledTag(schedule, index) {
  var q = Array.isArray(schedule) ? schedule.slice() : []
  var i = Number(index)
  if (!isFinite(i) || i < 0 || i >= q.length) return null
  q.splice(i, 1)
  return q
}

// Drop queued tags that are no longer among the known categories
// (e.g. a category deleted after it was queued). Returns the filtered
// queue.
function filterSchedule(schedule, tags) {
  var known = parseTags(tags)
  var q = Array.isArray(schedule) ? schedule.slice() : []
  return q.filter(function (t) { return known.indexOf(t) !== -1 })
}

// Take the next scheduled tag off the front of the queue. Tags that are
// no longer among the known categories are skipped and dropped, so a
// deleted category can never jam the queue at block end. Returns
// { tag, schedule } or null when the queue is empty or holds only
// unknown tags. The `tags` list is optional: without it, the front tag
// is taken as-is (the pre-existing behaviour).
function shiftSchedule(schedule, tags) {
  var q = Array.isArray(schedule) ? schedule.slice() : []
  var known = tags ? parseTags(tags) : null
  while (q.length) {
    var t = q.shift()
    if (!known || known.indexOf(t) !== -1)
      return { tag: t, schedule: q }
  }
  return null
}

// Save a schedule queue as a named preset. The name is trimmed; an
// empty name, an empty queue, or a duplicate name is rejected —
// overwriting a saved preset is done by deleting it first. Returns the
// new presets object, or null.
function saveSchedulePreset(presets, name, schedule) {
  var n = String(name || "").trim()
  var q = Array.isArray(schedule) ? schedule.slice() : []
  if (!n || !q.length) return null
  var p = (presets && typeof presets === "object" && !Array.isArray(presets)) ? presets : {}
  if (p[n] !== undefined) return null
  var out = {}
  for (var k in p) out[k] = p[k]
  out[n] = q
  return out
}

// Load a saved schedule preset: its tag array, or null when the name
// is not one of the saved presets.
function loadSchedulePreset(presets, name) {
  var p = (presets && typeof presets === "object" && !Array.isArray(presets)) ? presets : {}
  var q = p[String(name)]
  return Array.isArray(q) && q.length ? q.slice() : null
}

// Delete a saved schedule preset. Returns the new presets object, or
// null when the name is not one of the saved presets.
function deleteSchedulePreset(presets, name) {
  var p = (presets && typeof presets === "object" && !Array.isArray(presets)) ? presets : {}
  if (p[String(name)] === undefined) return null
  var out = {}
  for (var k in p) if (k !== String(name)) out[k] = p[k]
  return out
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

// A GUI toggle that is on unless the config turns it off: a missing or
// null value is on (the existing behaviour), an explicit false is off,
// anything else is read as a boolean. The Breather link and auto-launch
// toggles both use it, so a focusd.json written before they existed
// keeps the link on.
function parseOnByDefault(value) {
  if (value === undefined || value === null) return true
  return !!value
}

// Launch the Breather once per break, on the first poll where the break is
// running. launchedFor is the session key the Breather already launched for
// ("" if none this break). A break that starts paused does not launch until
// the user resumes it, and pause/resume mid-break does not relaunch. minutes
// is the break's remaining time in whole minutes; 0 means unknown, so no
// launch. An empty breakPattern turns the link off. breatherEnabled is the
// link's master switch and autoLaunch the auto-launch toggle — both on by
// default, so omitting them (as the old callers do) keeps the old behaviour;
// either one off means no launch. Turning auto-launch off keeps the link
// configured (the pattern is untouched), so flipping it back on resumes
// launching; turning the link off is the same, at the link level.
function shouldLaunchBreather(sessionKey, status, launchedFor, breakPattern, minutes, breatherEnabled, autoLaunch) {
  if (!breakPattern) return false
  if (breatherEnabled !== undefined && !breatherEnabled) return false
  if (autoLaunch !== undefined && !autoLaunch) return false
  if (!isBreakSession(sessionKey)) return false
  if (status !== "running") return false
  if (launchedFor === sessionKey) return false
  if (minutes <= 0) return false
  return true
}

// ---- Breather pattern picker (panel) ----
// The panel's Breather section offers a pattern Dropdown. The options are
// the three built-ins (box, 478, coherent) plus the customs from
// ~/.config/omarchy/zen/patterns.json, in file order — the same list the
// Breather's own picker shows. Only the key and name are needed here (the
// Breather validates the phases when the pattern is actually used, and an
// unknown name falls back to box inside the Breather), so a custom entry
// needs just a valid key and a non-empty name to be offered; anything
// else is skipped, never fatal. A custom key that collides with a
// built-in is ignored — built-ins win.
var BREATHER_PATTERN_ORDER = ["box", "478", "coherent"]
var BREATHER_PATTERN_NAMES = {
  box: "Box breathing",
  "478": "4-7-8",
  coherent: "Coherent"
}

function parseBreatherCustomPatterns(raw) {
  var out = []
  var seen = {}
  try {
    var parsed = JSON.parse(raw || "{}")
    var list = parsed && parsed.patterns
    if (!Array.isArray(list)) return out
    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      if (!p || typeof p.key !== "string") continue
      var key = p.key.toLowerCase()
      if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) continue
      if (seen[key]) continue
      if (BREATHER_PATTERN_NAMES[key]) continue
      if (typeof p.name !== "string" || p.name.length === 0) continue
      // Only mark a key seen once it has passed every check and is about
      // to be offered: a nameless entry must not poison the key for a
      // later named entry with the same key.
      seen[key] = true
      out.push({ key: key, name: p.name })
    }
  } catch (e) {}
  return out
}

// Option lists for the panel's pattern Dropdown: { value, label } pairs
// the shell Dropdown renders (label is what shows, value is what is
// emitted). Built-ins first, customs after, in file order.
function breatherPatternOptions(patternsRaw) {
  var out = []
  for (var i = 0; i < BREATHER_PATTERN_ORDER.length; i++) {
    var k = BREATHER_PATTERN_ORDER[i]
    out.push({ value: k, label: BREATHER_PATTERN_NAMES[k] })
  }
  var customs = parseBreatherCustomPatterns(patternsRaw)
  for (var j = 0; j < customs.length; j++)
    out.push({ value: customs[j].key, label: customs[j].name })
  return out
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
// per completed work block. Invalid or empty text reads as an empty log for
// display. Writes never start from that: applySessionEdit refuses to write
// over text that is not a valid log, so a corrupted file is left for the
// user to repair. Entries missing a field are dropped.
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
// invalid entry leaves the log unchanged. Invalid existing text is replaced
// by a log holding just this entry: callers that write must check the text
// first (applySessionEdit does); this function does not.
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

// ---- Sessions log edits ----
/**
 * Applies one append or retag to a fresh sessions-log snapshot without I/O.
 * write-config compares the exact base bytes before temp creation and again
 * before replacement; a conflict is retried from a fresh read.
 * @param {string} freshText Exact serialized log text read from disk.
 * @param {Object} edit `append` with an entry, or `retag` with a tag and the last block the panel showed.
 * @param {number} maxBytes Maximum serialized log size, in UTF-8 bytes.
 * @returns {{text: string}|{skip: string}} New compact JSON, or a reason no write is safe.
 * @remarks The final compare and `os.replace` are separate syscalls; an external write in that tiny interval may still win.
 */
function applySessionEdit(freshText, edit, maxBytes) {
  var raw = String(freshText || "").trim()
  if (!sessionLogTextOk(raw)) return { skip: "the file is not a valid sessions log" }
  var text
  if (edit && edit.kind === "retag") {
    var log = parseSessionLog(raw)
    var last = log[log.length - 1]
    var expect = edit.expect || {}
    if (!last || last.date !== expect.date || last.tag !== expect.tag || last.minutes !== expect.minutes)
      return { skip: "the last block on disk is not the block shown" }
    if (!String(edit.tag || "")) return { skip: "no tag to set" }
    text = retagSessionLog(raw, edit.tag)
  } else {
    text = appendSessionLog(raw, edit && edit.entry)
  }
  if (wellFormedUtf8(text).bytes > maxBytes) return { skip: "the log would pass the 1 MiB cap" }
  return { text: text }
}

/**
 * Checks whether sessions-log text is safe to replace.
 * @param {string} text Serialized JSON log contents.
 * @returns {boolean} True for empty text or a JSON array; malformed/non-array text is preserved.
 */
function sessionLogTextOk(text) {
  var raw = String(text || "").trim()
  if (!raw) return true
  try {
    return Array.isArray(JSON.parse(raw))
  } catch (e) {
    return false
  }
}

/**
 * Describes a skipped sessions-log edit without including file contents.
 * @param {string} sessionsPath Destination path for the sessions log.
 * @param {Object} edit Append or retag operation that was refused.
 * @param {string} reason Short reason the edit could not be applied.
 * @returns {string} Warning text suitable for the shell log.
 */
function sessionEditSkipMessage(sessionsPath, edit, reason) {
  var what = edit && edit.kind === "retag" ? "tag change" : "block"
  return "Focusd: " + what + " not saved to " + String(sessionsPath || "") + ": " + String(reason || "unknown reason") + ", nothing written"
}

// write-config's exit status for a guarded write (--expect) whose file no
// longer holds the text the edit was built from. Nothing was written. The
// sessions log and focusd.json both write this way.
var FILE_CHANGED_EXIT = 3
// A conflicted edit (sessions log or focusd.json) goes back to a fresh read,
// but only this many times in all; after that it is dropped with a warning,
// so a file that keeps changing cannot hold the queue forever.
var EDIT_MAX_CONFLICTS = 3
/**
 * Splits conflicted edits into retries and edits dropped after the retry cap.
 * @param {Object[]} edits Pending sessions-log or focusd.json edits with conflict counts.
 * @returns {{retry: Object[], dropped: Object[]}} New arrays; input objects are copied.
 */
function retryConflictedEdits(edits) {
  var retry = []
  var dropped = []
  var list = Array.isArray(edits) ? edits : []
  for (var i = 0; i < list.length; i++) {
    var marked = {}
    for (var key in list[i]) marked[key] = list[i][key]
    marked.conflicts = (Number(list[i].conflicts) || 0) + 1
    if (marked.conflicts < EDIT_MAX_CONFLICTS) retry.push(marked)
    else dropped.push(marked)
  }
  return { retry: retry, dropped: dropped }
}

/**
 * Applies queued focusd.json key writes to a fresh read of the file, without I/O.
 * The panel never writes focusd.json from its in-memory copy: a key or value
 * removed or changed by hand since the last poll (focusLogPath, the export
 * destination, above all) would be written back. Each edit sets one key on the
 * text just read; every other key is exactly what the file holds now.
 * @param {string} freshText focusd.json text as read from disk ("" for no file).
 * @param {Object[]} edits `{key, value}` writes in the order the panel made them.
 * @returns {{text: string}|{skip: string}} The text to write (freshText itself
 *   when no edit changes a value), or why no write is safe.
 */
function applyConfigEdits(freshText, edits) {
  if (!configTextOk(freshText)) return { skip: "the file is not a valid JSON object" }
  var raw = String(freshText || "").trim()
  var obj = raw ? JSON.parse(raw) : {}
  var changed = false
  var list = Array.isArray(edits) ? edits : []
  for (var i = 0; i < list.length; i++) {
    var key = String(list[i].key)
    if (JSON.stringify(obj[key]) === JSON.stringify(list[i].value)) continue
    obj[key] = list[i].value
    changed = true
  }
  if (!changed) return { text: String(freshText || "") }
  return { text: JSON.stringify(obj, null, 2) + "\n" }
}

/**
 * Describes a dropped focusd.json key write without including file contents.
 * @param {string} configPath Path of focusd.json.
 * @param {Object} edit The `{key, value}` write that was dropped.
 * @param {string} reason Short reason the write could not be applied.
 * @returns {string} Warning text suitable for the shell log.
 */
function configEditSkipMessage(configPath, edit, reason) {
  return "Focusd: setting " + String(edit && edit.key) + " not saved to " + String(configPath || "") + ": " + String(reason || "unknown reason") + ", nothing written"
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

// The export format is chosen by the log path's extension: a path ending
// in .csv (any case) writes CSV, anything else writes the Markdown table.
// That keeps the export pointable anywhere — an Obsidian note, a plain
// folder, a spreadsheet — with no extra setting to learn. The format
// lives in the filename, so renaming the file changes the format.
function focusLogFormat(focusLogPath) {
  var path = String(focusLogPath || "").toLowerCase();
  return path.slice(-4) === ".csv" ? "csv" : "md";
}

var FOCUS_LOG_CSV_HEADER = "Date,Tag,Minutes,Source";

// One CSV field, RFC 4180: wrap in double quotes when it holds a comma,
// a quote, or a newline, and double any embedded quotes. Formula
// injection: a value starting with =, +, -, @, tab, or CR is prefixed
// with a single quote, so a spreadsheet treats it as text instead of
// running it as a formula. Tags are user-typed, so this is the field
// that needs it.
function csvField(value) {
  var s = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(s))
    s = "'" + s;
  if (/[",\n\r]/.test(s))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Build the full Focus Log CSV from the sessions log text. One row per
// completed block, same rows as the Markdown table, tags CSV-escaped so
// a comma or quote in a tag can never break the columns. The Source
// column marks the file as generated by OmaPomodorchy — the overwrite
// guard recognises it, so a hand-written CSV with a plain
// Date,Tag,Minutes header is left alone. An empty or invalid log is
// just the header (no rows).
function focusLogCsvText(text) {
  var log = parseSessionLog(text);
  var out = [FOCUS_LOG_CSV_HEADER];
  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    out.push(e.date + "," + csvField(e.tag || "") + "," + e.minutes + ",OmaPomodorchy");
  }
  return out.join("\n") + "\n";
}

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

/**
 * Produces well-formed text and its UTF-8 byte length for write-config.
 * @param {string} content Text to encode; lone surrogates become U+FFFD.
 * @returns {{text: string, bytes: number}} Encoded text and byte count.
 */
function wellFormedUtf8(content) {
  var s = String(content == null ? "" : content)
  var bytes = 0
  var out = []
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      out.push(s.charAt(i) + s.charAt(i + 1))
      bytes += 4
      i++
    } else if (c >= 0xd800 && c <= 0xdfff) {
      out.push("\ufffd")
      bytes += 3
    } else {
      out.push(s.charAt(i))
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3
    }
  }
  return { text: out.join(""), bytes: bytes }
}

/**
 * Frames write-config stdin as a UTF-8 byte count followed by content.
 * @param {string} content Text to write.
 * @returns {string} Length-prefixed stdin payload, with the byte count in UTF-8 units.
 */
function writeConfigInput(content) {
  var framed = wellFormedUtf8(content)
  return framed.bytes + "\n" + framed.text
}

/**
 * Frames an expected base and replacement text for a guarded write-config operation.
 * @param {string} base Exact prior file contents to compare before replacement.
 * @param {string} content New file contents to write.
 * @returns {string} Two length-prefixed stdin frames, each bounded by write-config.
 */
function writeConfigGuardedInput(base, content) {
  return writeConfigInput(base) + writeConfigInput(content)
}

/**
 * Determines whether a write-config process completed successfully.
 * @param {number} exitCode Process exit code.
 * @param {boolean} timedOut Whether the watchdog killed the process.
 * @returns {boolean} True only for exit code 0 without a watchdog timeout.
 */
function writeSucceeded(exitCode, timedOut) {
  return !timedOut && exitCode === 0
}


/** Exit status used when write-config refuses a non-generated Focus Log file. */
var FOCUS_LOG_GUARD_SKIP_EXIT = 2
function focusLogSkipMessage(focusLogPath) {
  return "Focus Log write skipped: " + String(focusLogPath || "") +
    " already exists and is not a generated Focus Log (no generated header), leaving it alone"
}

/**
 * Builds argv for atomically writing a generated Focus Log export.
 * @param {string} writeScriptPath Path to the write-config script.
 * @param {string} focusLogPath Absolute export path; a `.csv` suffix selects CSV upstream.
 * @returns {string[]|null} Shell argv, or null when export is disabled/invalid.
 * @remarks Non-empty files are replaced only when they carry the generated marker; an empty file is safe to replace.
 */
function focusLogCommand(writeScriptPath, focusLogPath) {
  var path = String(focusLogPath || "")
  if (!path || path.charAt(0) !== "/") return null
  // -s, not -e: an empty file (a first write killed after --create) has nothing to guard.
  return ["sh", "-c",
    'mkdir -p "$(dirname "$1")" && if [ -s "$1" ] && ! head -n 3 "$1" | grep -qE "This note is generated from|Sessions logged by OmoPomodorachy|^Date,Tag,Minutes,Source"; then exit 2; fi && exec bash "$2" --create "$1"',
    "sh", path, String(writeScriptPath || "")]
}

/**
 * Resolves a queued Focus Log export into the write to run now.
 * @param {string} writeScriptPath Path to the write-config script.
 * @param {string} focusLogPath The export destination in effect when the write runs; empty when the export is off.
 * @param {boolean} sessionsLoadedOk Whether the sessions log was last read and validated successfully.
 * @param {string} sessionsRaw Sessions log text the export is generated from.
 * @returns {{path: string, command: string[], input: string}|null} Destination, write-config argv and framed stdin; null when nothing must be written (export off, invalid path, or sessions log not loaded).
 * @remarks Called when the queued job reaches the head of the write queue, not when it is queued, so a destination changed while the job waited gets the export (in its own extension's format) and a removed one gets nothing.
 */
function focusLogExportWrite(writeScriptPath, focusLogPath, sessionsLoadedOk, sessionsRaw) {
  if (!sessionsLoadedOk) return null
  var path = String(focusLogPath || "")
  var command = focusLogCommand(writeScriptPath, path)
  if (!command) return null
  var text = focusLogFormat(path) === "csv" ? focusLogCsvText(sessionsRaw) : focusLogText(sessionsRaw)
  return { path: path, command: command, input: writeConfigInput(text) }
}

/**
 * Encodes a local path as a file URL for Qt.openUrlExternally.
 * @param {string} path Local filesystem path; query and fragment characters are escaped.
 * @returns {string} A `file://` URL; performs no I/O.
 */
function fileUrl(path) {
  return "file://" + encodeURI(String(path || "")).replace(/#/g, "%23").replace(/\?/g, "%3F")
}
