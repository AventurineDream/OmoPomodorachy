// Node harness for FocusdModel.js. Run: node test/FocusdModel.test.js
// The QML service is reviewed by diff and verified on dooracle instead.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const src = fs.readFileSync(path.join(__dirname, "..", "FocusdModel.js"), "utf8");
const factory = new Function(
  src + "\nreturn { FREEDESKTOP_SOUNDS, DEFAULT_SOUND, resolveSoundFile, chimeCommand, sessionEnded, shouldChime, isBreakSession, breatherCommand, parseMinutes, parseOnByDefault, shouldLaunchBreather, breatherPatternOptions, parseBreatherCustomPatterns, DURATION_LIMITS, clampDuration, parseDurations, presetSection, updateDuration, listPresets, setActivePreset, validPresetName, savePresetAs, clampRounds, workSessionEnded, shouldStopAfterRound, DEFAULT_TAGS, parseTags, addTag, removeTag, enqueueTag, removeScheduledTag, filterSchedule, shiftSchedule, saveSchedulePreset, loadSchedulePreset, deleteSchedulePreset, parseSeconds, elapsedMinutes, parseSessionLog, appendSessionLog, retagSessionLog, nextTag, applyConfigEdits, configEditSkipMessage, configTextOk, FOCUS_LOG_HEADER, FOCUS_LOG_CSV_HEADER, focusLogFormat, focusLogText, focusLogCsvText, focusLogCommand, FOCUS_LOG_GUARD_SKIP_EXIT, focusLogSkipMessage };"
);
// writeConfigInput: the framed stdin that write-config reads (FocusdModel.js).
const { writeConfigInput } = new Function(src + "\nreturn { writeConfigInput };")();
const M = factory();

let pass = 0;
function check(name, ok) {
  if (ok) {
    pass++;
  } else {
    process.exitCode = 1;
    console.error("FAIL:", name);
  }
}

// --- Sound file resolution ---
check("bare name resolves into the theme", M.resolveSoundFile("complete.oga") === "/usr/share/sounds/freedesktop/stereo/complete.oga");
check("path used as-is", M.resolveSoundFile("/home/aven/chime.ogg") === "/home/aven/chime.ogg");
check("empty name falls back to the default", M.resolveSoundFile("") === "/usr/share/sounds/freedesktop/stereo/complete.oga");
check("default sound is complete.oga", M.DEFAULT_SOUND === "complete.oga");

// --- chimeCommand argv ---
const cmd = M.chimeCommand("/usr/share/sounds/freedesktop/stereo/complete.oga");
check("chimeCommand argv", cmd[0] === "sh" && cmd[1] === "-c" && cmd[3] === "sh");
check("chimeCommand path arg", cmd[4] === "/usr/share/sounds/freedesktop/stereo/complete.oga");
check(
  "chimeCommand path is an arg, not syntax",
  !cmd[2].includes("/usr/share/sounds/freedesktop/stereo/complete.oga")
);
check(
  "chimeCommand guards a missing file",
  cmd[2].includes('[ -f "$f" ] || exit 0')
);
check(
  "chimeCommand tries pw-play then paplay",
  cmd[2].includes("pw-play") && cmd[2].includes("paplay")
);
// A missing file exits silently (no player needed, no throw).
const missingCmd = M.chimeCommand("/no/such/file.oga");
let missingThrew = false;
try {
  execFileSync(missingCmd[0], missingCmd.slice(1), { stdio: "ignore" });
} catch (e) {
  missingThrew = true;
}
check("missing sound file exits silently", !missingThrew);

// --- shouldChime ---
check("first poll never chimes", M.shouldChime("", "", "work", true) === false);
check("same session never chimes", M.shouldChime("work", "running", "work", true) === false);
check("work to short break chimes", M.shouldChime("work", "running", "short-break", true) === true);
check("short break to work chimes", M.shouldChime("short-break", "running", "work", true) === true);
check("work to long break chimes", M.shouldChime("work", "running", "long-break", true) === true);
check("long break to work chimes", M.shouldChime("long-break", "running", "work", true) === true);
check("sounds off never chimes", M.shouldChime("work", "running", "short-break", false) === false);
check("empty next session never chimes", M.shouldChime("work", "running", "", true) === false);
check("pause keeps the session, so no chime", M.shouldChime("work", "running", "work", true) === false);
// Stop then start: the previous poll had the session paused (stopped), so
// starting a different session afterwards is a manual start, not a session
// ending. This is the false chime the stopped branches guard against.
check("stop during a break, then start work: no chime", M.shouldChime("short-break", "paused", "work", true) === false);
check("stop during work, then start a break: no chime", M.shouldChime("work", "paused", "short-break", true) === false);
// A daemon restart clears the previous session (the stopped branches), so
// the timer coming back as Work reads as a first poll.
check("daemon restart after a stop: no chime", M.shouldChime("", "", "work", true) === false);
// Skipping while paused ends a session the user already stopped, so it
// stays silent too; skipping while running chimes.
check("skip while paused: no chime", M.shouldChime("work", "paused", "short-break", true) === false);
check("skip while running: chimes", M.shouldChime("work", "running", "short-break", true) === true);

// --- sessionEnded (the shared edge) ---
check("sessionEnded: running work to break", M.sessionEnded("work", "running", "short-break") === true);
check("sessionEnded: first poll", M.sessionEnded("", "", "work") === false);
check("sessionEnded: same session", M.sessionEnded("work", "running", "work") === false);
check("sessionEnded: paused to different", M.sessionEnded("work", "paused", "short-break") === false);

// --- isBreakSession ---
check("short break is a break", M.isBreakSession("short-break") === true);
check("long break is a break", M.isBreakSession("long-break") === true);
check("work is not a break", M.isBreakSession("work") === false);
check("empty is not a break", M.isBreakSession("") === false);

// --- breatherCommand argv ---
const bc = M.breatherCommand("478", 5);
check("breatherCommand argv", bc[0] === "omarchy-shell" && bc[1] === "shell" && bc[2] === "summon" && bc[3] === "aven.terminal-breather");
const payload = JSON.parse(bc[4]);
check("breatherCommand payload pattern", payload.pattern === "478");
check("breatherCommand payload minutes", payload.minutes === 5);
// A pattern name with quotes is JSON-escaped, not shell syntax.
const tricky = M.breatherCommand('a"b', 5);
const trickyPayload = JSON.parse(tricky[4]);
check("breatherCommand escapes a quoted pattern", trickyPayload.pattern === 'a"b');
check("breatherCommand payload is one argument", tricky.length === 5);

// --- parseMinutes (rounded down, so the Breather ends before the break) ---
check("05:00 is 5 minutes", M.parseMinutes("05:00") === 5);
check("04:59 rounds down to 4", M.parseMinutes("04:59") === 4);
check("15:00 is 15 minutes", M.parseMinutes("15:00") === 15);
check("04:30 rounds down to 4", M.parseMinutes("04:30") === 4);
check("00:30 is 1 minute (minimum)", M.parseMinutes("00:30") === 1);
check("1:00:00 is 60 minutes", M.parseMinutes("1:00:00") === 60);
check("25:00 is 25 minutes", M.parseMinutes("25:00") === 25);
check("empty text is 0", M.parseMinutes("") === 0);
check("non-time text is 0", M.parseMinutes("paused") === 0);
check("00:00 is 0", M.parseMinutes("00:00") === 0);

// --- parseOnByDefault (Breather toggles: on unless the config says off) ---
check("missing or null toggle is on", M.parseOnByDefault(undefined) === true && M.parseOnByDefault(null) === true);
check("explicit true stays on", M.parseOnByDefault(true) === true);
check("explicit false is off", M.parseOnByDefault(false) === false);
check("truthy values read as on", M.parseOnByDefault(1) === true && M.parseOnByDefault("yes") === true);
check("falsy values read as off", M.parseOnByDefault(0) === false && M.parseOnByDefault("") === false);

// --- shouldLaunchBreather (once per break, first running poll) ---
check("running break, not launched: launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5) === true);
check("long break, not launched: launch", M.shouldLaunchBreather("long-break", "running", "", "478", 15) === true);
check("paused break: no launch (waits for resume)", M.shouldLaunchBreather("short-break", "paused", "", "box", 5) === false);
check("already launched this break: no relaunch", M.shouldLaunchBreather("short-break", "running", "short-break", "box", 5) === false);
check("work session: no launch", M.shouldLaunchBreather("work", "running", "", "box", 25) === false);
check("empty pattern (link off): no launch", M.shouldLaunchBreather("short-break", "running", "", "", 5) === false);
check("0 minutes (unknown remaining): no launch", M.shouldLaunchBreather("short-break", "running", "", "box", 0) === false);
check("negative minutes: no launch", M.shouldLaunchBreather("short-break", "running", "", "box", -1) === false);
// After a work session the launch key clears, so the next break of the
// same kind launches again.
check("next short break after work: launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5) === true);
// Breather toggles: either one off means no launch, and omitting them
// (the old 5-arg calls above) keeps the old behaviour.
check("link off: no launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5, false, true) === false);
check("auto-launch off: no launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5, true, false) === false);
check("both toggles off: no launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5, false, false) === false);
check("both toggles on: launch", M.shouldLaunchBreather("short-break", "running", "", "box", 5, true, true) === true);

// --- breatherPatternOptions (panel pattern picker) ---
const emptyOpts = M.breatherPatternOptions("");
check("no customs: built-ins only", emptyOpts.length === 3 && emptyOpts[0].value === "box" && emptyOpts[1].value === "478" && emptyOpts[2].value === "coherent");
check("built-in labels", emptyOpts[0].label === "Box breathing" && emptyOpts[1].label === "4-7-8" && emptyOpts[2].label === "Coherent");
check("missing raw: built-ins only", M.breatherPatternOptions().length === 3);
check("malformed JSON: built-ins only, no throw", M.breatherPatternOptions("{not json").length === 3);
check("no patterns array: built-ins only", M.breatherPatternOptions('{"other": 1}').length === 3);
const customsRaw = JSON.stringify({ patterns: [
  { key: "slow-6", name: "Slow 6", phases: [{ label: "Breathe in", secs: 6, to: 1 }, { label: "Breathe out", secs: 6, to: 0 }] },
  { key: "calm-466", name: "Calm 4-6-6", phases: [{ label: "Breathe in", secs: 4, to: 1 }, { label: "Breathe out", secs: 6, to: 0 }] },
  { key: "breath-of-fire", name: "Breath of Fire", phases: [{ label: "In", secs: 0.5, to: 1 }, { label: "Out", secs: 0.5, to: 0 }] },
] });
const customsOpts = M.breatherPatternOptions(customsRaw);
check("customs append in file order", customsOpts.length === 6 && customsOpts[3].value === "slow-6" && customsOpts[4].value === "calm-466" && customsOpts[5].value === "breath-of-fire");
check("custom labels come from the file", customsOpts[3].label === "Slow 6" && customsOpts[5].label === "Breath of Fire");
const collideRaw = JSON.stringify({ patterns: [
  { key: "box", name: "My Box", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "BOX", name: "Upper Box", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "bad key!", name: "Bad Key", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "noname", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "dup", name: "First", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "dup", name: "Second", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
  { key: "good-one", name: "Good One", phases: [{ label: "In", secs: 4, to: 1 }, { label: "Out", secs: 4, to: 0 }] },
] });
const collideOpts = M.breatherPatternOptions(collideRaw);
check("built-in collision ignored, bad keys and nameless skipped, dup kept once", collideOpts.length === 5 && collideOpts[3].value === "dup" && collideOpts[3].label === "First" && collideOpts[4].value === "good-one");
check("parseBreatherCustomPatterns parses keys and names only", JSON.stringify(M.parseBreatherCustomPatterns(customsRaw)) === JSON.stringify([{ key: "slow-6", name: "Slow 6" }, { key: "calm-466", name: "Calm 4-6-6" }, { key: "breath-of-fire", name: "Breath of Fire" }]));
const namelessFirstRaw = JSON.stringify({ patterns: [
  { key: "slow-6", phases: [{ label: "In", secs: 6, to: 1 }, { label: "Out", secs: 6, to: 0 }] },
  { key: "slow-6", name: "Slow 6", phases: [{ label: "In", secs: 6, to: 1 }, { label: "Out", secs: 6, to: 0 }] },
] });
const namelessFirstOpts = M.breatherPatternOptions(namelessFirstRaw);
check("nameless entry does not poison the key for a later named entry", namelessFirstOpts.length === 4 && namelessFirstOpts[3].value === "slow-6" && namelessFirstOpts[3].label === "Slow 6");
const capsRaw = JSON.stringify({ patterns: [
  { key: "Slow-6", name: "Slow 6", phases: [{ label: "In", secs: 6, to: 1 }, { label: "Out", secs: 6, to: 0 }] },
] });
check("capitalised custom key is offered lowercased (Breather lowercases too)", JSON.stringify(M.parseBreatherCustomPatterns(capsRaw)) === JSON.stringify([{ key: "slow-6", name: "Slow 6" }]));

// --- Durations (TOML parse / update) ---
const SAMPLE_TOML = [
  "# Which preset is currently active",
  'active_preset = "pomodoro"',
  "daily_goal_minutes = 0",
  "",
  "[presets.pomodoro]",
  "work_minutes = 25",
  "short_break_minutes = 5",
  "long_break_minutes = 15",
  "sessions_before_long_break = 4",
  "",
  "[presets.deep_work]",
  "work_minutes = 50",
  "short_break_minutes = 10",
  "long_break_minutes = 30",
  "sessions_before_long_break = 4",
  "",
  "# [presets.study]",
  "# work_minutes = 45",
  "",
].join("\n");

const parsed = M.parseDurations(SAMPLE_TOML);
check("parseDurations finds the active preset", parsed && parsed.preset === "pomodoro");
check("parseDurations reads work", parsed && parsed.work === 25);
check("parseDurations reads short break", parsed && parsed.shortBreak === 5);
check("parseDurations reads long break", parsed && parsed.longBreak === 15);
const deepToml = SAMPLE_TOML.replace('active_preset = "pomodoro"', 'active_preset = "deep_work"');
const deep = M.parseDurations(deepToml);
check("parseDurations follows the active preset", deep && deep.preset === "deep_work" && deep.work === 50 && deep.shortBreak === 10 && deep.longBreak === 30);
check("parseDurations: missing preset is null", M.parseDurations(SAMPLE_TOML.replace('[presets.pomodoro]', "[presets.other]")) === null);
check("parseDurations: missing key is null", M.parseDurations(SAMPLE_TOML.replace("work_minutes = 25\n", "")) === null);
check("parseDurations: no active_preset is null", M.parseDurations(SAMPLE_TOML.replace('active_preset = "pomodoro"\n', "")) === null);
check("parseDurations: empty text is null", M.parseDurations("") === null);

const updated = M.updateDuration(SAMPLE_TOML, "work", 45);
check("updateDuration returns text", typeof updated === "string");
const reparsed = M.parseDurations(updated);
check("updateDuration writes work", reparsed && reparsed.work === 45);
check("updateDuration leaves the other keys alone", reparsed && reparsed.shortBreak === 5 && reparsed.longBreak === 15);
const updatedShort = M.updateDuration(SAMPLE_TOML, "shortBreak", 8);
check("updateDuration writes short break", M.parseDurations(updatedShort).shortBreak === 8 && M.parseDurations(updatedShort).work === 25);
const updatedLong = M.updateDuration(SAMPLE_TOML, "longBreak", 20);
check("updateDuration writes long break", M.parseDurations(updatedLong).longBreak === 20 && M.parseDurations(updatedLong).work === 25);
check("updateDuration leaves deep_work alone", updated.includes("work_minutes = 50") && updated.includes("short_break_minutes = 10") && updated.includes("long_break_minutes = 30"));
check("updateDuration preserves comments and other keys", updated.includes("# Which preset is currently active") && updated.includes("daily_goal_minutes = 0") && updated.includes("sessions_before_long_break = 4"));
check("updateDuration preserves the commented preset", updated.includes("# [presets.study]") && updated.includes("# work_minutes = 45"));
check("updateDuration clamps work to 90", M.parseDurations(M.updateDuration(SAMPLE_TOML, "work", 200)).work === 90);
check("updateDuration clamps short break to 1", M.parseDurations(M.updateDuration(SAMPLE_TOML, "shortBreak", 0)).shortBreak === 1);
check("updateDuration clamps long break to 60", M.parseDurations(M.updateDuration(SAMPLE_TOML, "longBreak", 999)).longBreak === 60);
check("updateDuration: missing preset is null", M.updateDuration(SAMPLE_TOML.replace('[presets.pomodoro]', "[presets.other]"), "work", 45) === null);
check("updateDuration: non-numeric value is null", M.updateDuration(SAMPLE_TOML, "work", "abc") === null);
check("updateDuration: missing key is null", M.updateDuration(SAMPLE_TOML.replace("long_break_minutes = 15\n", ""), "longBreak", 20) === null);
check("updateDuration: unknown kind is null", M.updateDuration(SAMPLE_TOML, "nope", 45) === null);
check("updateDuration: no change returns the text untouched", M.updateDuration(SAMPLE_TOML, "work", 25) === SAMPLE_TOML);

// The review gap: a TUI change to one key must survive moving a different
// slider. Only the released slider's key is ever passed in, so the other
// keys are never written back — even when their slider values are stale.
const TUI_CHANGED_TOML = SAMPLE_TOML.replace("work_minutes = 25", "work_minutes = 30");
const afterShortMove = M.updateDuration(TUI_CHANGED_TOML, "shortBreak", 8);
check("moving short break keeps a TUI work change", afterShortMove !== null && M.parseDurations(afterShortMove).work === 30 && M.parseDurations(afterShortMove).shortBreak === 8);
const afterLongMove = M.updateDuration(TUI_CHANGED_TOML, "longBreak", 20);
check("moving long break keeps a TUI work change", afterLongMove !== null && M.parseDurations(afterLongMove).work === 30 && M.parseDurations(afterLongMove).longBreak === 20);

// An out-of-range preset value is left alone unless that slider moves.
const OUT_OF_RANGE_TOML = SAMPLE_TOML.replace("work_minutes = 25", "work_minutes = 120").replace("long_break_minutes = 15", "long_break_minutes = 2");
const oor = M.parseDurations(OUT_OF_RANGE_TOML);
check("out-of-range values parse", oor && oor.work === 120 && oor.longBreak === 2);
const oorMovedShort = M.updateDuration(OUT_OF_RANGE_TOML, "shortBreak", 8);
check("moving short break leaves a 120-min work value alone", oorMovedShort !== null && M.parseDurations(oorMovedShort).work === 120 && M.parseDurations(oorMovedShort).shortBreak === 8);
check("moving short break leaves a 2-min long break alone", oorMovedShort !== null && M.parseDurations(oorMovedShort).longBreak === 2);
const oorMovedWork = M.updateDuration(OUT_OF_RANGE_TOML, "work", 45);
check("moving work rewrites only work", oorMovedWork !== null && M.parseDurations(oorMovedWork).work === 45 && M.parseDurations(oorMovedWork).longBreak === 2);

check("clampDuration work 5..90", M.clampDuration("work", 4) === 5 && M.clampDuration("work", 91) === 90 && M.clampDuration("work", 25) === 25);
check("clampDuration short 1..30", M.clampDuration("shortBreak", 0) === 1 && M.clampDuration("shortBreak", 31) === 30);
check("clampDuration long 5..60", M.clampDuration("longBreak", 4) === 5 && M.clampDuration("longBreak", 61) === 60);
check("clampDuration rounds", M.clampDuration("work", 25.6) === 26);
check("clampDuration unknown kind is null", M.clampDuration("nope", 5) === null);
check("clampDuration non-numeric is null", M.clampDuration("work", "abc") === null);

// --- Rounds before stop ---
check("workSessionEnded: work -> short-break (running) ends a round", M.workSessionEnded("work", "running", "short-break") === true);
check("workSessionEnded: work -> long-break (running) ends a round", M.workSessionEnded("work", "running", "long-break") === true);
check("workSessionEnded: work -> work is not a round", M.workSessionEnded("work", "running", "work") === false);
check("workSessionEnded: break -> work is not a round", M.workSessionEnded("short-break", "running", "work") === false);
check("workSessionEnded: paused work -> break is not a round", M.workSessionEnded("work", "paused", "short-break") === false);
check("workSessionEnded: first poll (no prev) is not a round", M.workSessionEnded("", "", "short-break") === false);
check("shouldStopAfterRound: off (0) never stops", M.shouldStopAfterRound(0, 99) === false);
check("shouldStopAfterRound: 3 of 4 does not stop", M.shouldStopAfterRound(4, 3) === false);
check("shouldStopAfterRound: 4 of 4 stops", M.shouldStopAfterRound(4, 4) === true);
check("shouldStopAfterRound: over the limit stops", M.shouldStopAfterRound(4, 5) === true);
check("clampRounds 0..12", M.clampRounds(0) === 0 && M.clampRounds(1) === 1 && M.clampRounds(12) === 12 && M.clampRounds(13) === 12 && M.clampRounds(-1) === 0);
check("clampRounds rounds", M.clampRounds(4.6) === 5);
check("clampRounds non-numeric is null", M.clampRounds("abc") === null);

// --- Block tagging ---
check("DEFAULT_TAGS has the five starters", JSON.stringify(M.DEFAULT_TAGS) === JSON.stringify(["Work", "Study", "Art", "Admin", "Other"]));
check("parseTags: missing is the default", JSON.stringify(M.parseTags(undefined)) === JSON.stringify(M.DEFAULT_TAGS));
check("parseTags: null is the default", JSON.stringify(M.parseTags(null)) === JSON.stringify(M.DEFAULT_TAGS));
check("parseTags: a list passes through", JSON.stringify(M.parseTags(["Art", "Study"])) === JSON.stringify(["Art", "Study"]));
check("parseTags: a single string is one tag", JSON.stringify(M.parseTags("Art")) === JSON.stringify(["Art"]));
check("parseTags: blanks are dropped", JSON.stringify(M.parseTags(["Art", "", "  ", "Study"])) === JSON.stringify(["Art", "Study"]));
check("parseTags: entries are trimmed", JSON.stringify(M.parseTags(["  Art  "])) === JSON.stringify(["Art"]));
check("parseTags: duplicates are dropped", JSON.stringify(M.parseTags(["Art", "Art", "Study"])) === JSON.stringify(["Art", "Study"]));
check("parseTags: an empty list is the default", JSON.stringify(M.parseTags([])) === JSON.stringify(M.DEFAULT_TAGS));
check("parseTags: a non-list, non-string is the default", JSON.stringify(M.parseTags(42)) === JSON.stringify(M.DEFAULT_TAGS));
check("parseTags: a number inside the list is stringified", JSON.stringify(M.parseTags(["Art", 7])) === JSON.stringify(["Art", "7"]));

check("parseSeconds: 25:00 is 1500", M.parseSeconds("25:00") === 1500);
check("parseSeconds: 1:05:00 is 3900", M.parseSeconds("1:05:00") === 3900);
check("parseSeconds: 00:03 is 3", M.parseSeconds("00:03") === 3);
check("parseSeconds: empty is 0", M.parseSeconds("") === 0);
check("parseSeconds: non-time is 0", M.parseSeconds("paused") === 0);
check("parseSeconds: no colon is 0", M.parseSeconds("25") === 0);
check("parseSeconds: negative is 0", M.parseSeconds("-1:00") === 0);

check("elapsedMinutes: no previous poll is the full length", M.elapsedMinutes(25, 0) === 25);
check("elapsedMinutes: a block that ran out is the full length", M.elapsedMinutes(25, 3) === 25);
check("elapsedMinutes: a skip at 20:00 left is 5 elapsed", M.elapsedMinutes(25, 1200) === 5);
check("elapsedMinutes: a skip just after starting is 1 (minimum)", M.elapsedMinutes(25, 1490) === 1);
check("elapsedMinutes: more remaining than the length is 1", M.elapsedMinutes(25, 2000) === 1);
check("elapsedMinutes: a 50-min block skipped at 10:00 left is 40", M.elapsedMinutes(50, 600) === 40);
check("elapsedMinutes: non-numeric work length is 0", M.elapsedMinutes("abc", 0) === 0);

const SAMPLE_LOG = JSON.stringify([
  { date: "2026-11-11", tag: "Work", minutes: 25 },
  { date: "2026-11-11", tag: "Art", minutes: 5 },
], null, 2);
check("parseSessionLog: reads entries", M.parseSessionLog(SAMPLE_LOG).length === 2 && M.parseSessionLog(SAMPLE_LOG)[1].tag === "Art");
check("parseSessionLog: empty text is an empty log", M.parseSessionLog("").length === 0);
check("parseSessionLog: invalid JSON is an empty log", M.parseSessionLog("{oops").length === 0);
check("parseSessionLog: a non-array is an empty log", M.parseSessionLog('{"a":1}').length === 0);
check("parseSessionLog: entries missing a field are dropped", M.parseSessionLog(JSON.stringify([{ date: "2026-11-11", tag: "Work" }, { date: "2026-11-11", tag: "Art", minutes: 5 }])).length === 1);
check("parseSessionLog: a zero-minute entry is dropped", M.parseSessionLog(JSON.stringify([{ date: "2026-11-11", tag: "Work", minutes: 0 }])).length === 0);
check("appendSessionLog: appends to an existing log", M.parseSessionLog(M.appendSessionLog(SAMPLE_LOG, { date: "2026-11-11", tag: "Study", minutes: 25 })).length === 3);
check("appendSessionLog: output is compact JSON (one line)", M.appendSessionLog(SAMPLE_LOG, { date: "2026-11-11", tag: "Study", minutes: 25 }).indexOf("\n") === -1);
check("appendSessionLog: compact output still parses back", M.parseSessionLog(M.appendSessionLog(SAMPLE_LOG, { date: "2026-11-11", tag: "Study", minutes: 25 })).length === 3);
check("retagSessionLog: output is compact JSON (one line)", M.retagSessionLog(SAMPLE_LOG, "Study").indexOf("\n") === -1);
check("appendSessionLog: a fresh log starts with the entry", M.parseSessionLog(M.appendSessionLog("", { date: "2026-11-11", tag: "Work", minutes: 25 })).length === 1);
check("appendSessionLog: an invalid file is replaced with a fresh log", M.parseSessionLog(M.appendSessionLog("{oops", { date: "2026-11-11", tag: "Work", minutes: 25 })).length === 1);
check("appendSessionLog: an invalid entry leaves the log unchanged", M.parseSessionLog(M.appendSessionLog(SAMPLE_LOG, { date: "2026-11-11", tag: "", minutes: 25 })).length === 2);
check("retagSessionLog: changes the last entry's tag", M.parseSessionLog(M.retagSessionLog(SAMPLE_LOG, "Study"))[1].tag === "Study" && M.parseSessionLog(M.retagSessionLog(SAMPLE_LOG, "Study"))[0].tag === "Work");
check("retagSessionLog: an empty log is null", M.retagSessionLog("", "Study") === null);
check("retagSessionLog: an invalid log is null", M.retagSessionLog("{oops", "Study") === null);
check("nextTag: cycles forward", M.nextTag(["Work", "Study", "Art"], "Work") === "Study");
check("nextTag: wraps around", M.nextTag(["Work", "Study", "Art"], "Art") === "Work");
check("nextTag: an unknown tag starts at the first", M.nextTag(["Work", "Study", "Art"], "Other") === "Work");
check("nextTag: an empty list is empty", M.nextTag([], "Work") === "");

// --- focusd.json key writes (applyConfigEdits) ---
// Regression (marketplace review #15501): a key write built from the panel's
// in-memory copy put back a focusLogPath the user had removed by hand, and
// later exports went to the revoked file. Writes now apply to a fresh read.
const handRevoked = '{"rounds": 0, "tags": ["Work"]}';
const revokedWrite = M.applyConfigEdits(handRevoked, [{ key: "tagSchedule", value: ["Work"] }]);
check("applyConfigEdits: a key write never restores a focusLogPath the file no longer has", !("focusLogPath" in JSON.parse(revokedWrite.text)));
const handChanged = '{"focusLogPath": "/tmp/new.md", "rounds": 0}';
check("applyConfigEdits: a key write keeps a hand-changed focusLogPath", JSON.parse(M.applyConfigEdits(handChanged, [{ key: "rounds", value: 4 }]).text).focusLogPath === "/tmp/new.md");
const multi = JSON.parse(M.applyConfigEdits('{"rounds": 0, "tags": ["Work"]}', [{ key: "rounds", value: 4 }, { key: "rounds", value: 6 }, { key: "tagsExpanded", value: false }]).text);
check("applyConfigEdits: edits apply in order and keep the other keys", multi.rounds === 6 && multi.tagsExpanded === false && multi.tags[0] === "Work");
check("applyConfigEdits: an empty file starts fresh", JSON.parse(M.applyConfigEdits("", [{ key: "rounds", value: 4 }]).text).rounds === 4);
check("applyConfigEdits: an edit that changes nothing returns the file's exact text", M.applyConfigEdits('{"rounds":4}', [{ key: "rounds", value: 4 }]).text === '{"rounds":4}');
check("applyConfigEdits: output is indented JSON", M.applyConfigEdits("", [{ key: "rounds", value: 4 }]).text.indexOf('\n  "rounds": 4') !== -1);
check("applyConfigEdits: an invalid file is skipped, never rewritten", !!M.applyConfigEdits("{oops", [{ key: "rounds", value: 4 }]).skip);
check("applyConfigEdits: a JSON array is skipped", !!M.applyConfigEdits("[1]", [{ key: "rounds", value: 4 }]).skip);
check("configEditSkipMessage: names the key and the file, not the value", M.configEditSkipMessage("/c/focusd.json", { key: "focusLogPath", value: "/secret" }, "why").indexOf("/secret") === -1 && M.configEditSkipMessage("/c/focusd.json", { key: "rounds", value: 4 }, "why").indexOf("rounds") !== -1);

// --- Config write guard ---
check("configTextOk: empty text is safe (no file yet)", M.configTextOk("") === true);
check("configTextOk: whitespace-only is safe", M.configTextOk("  \n ") === true);
check("configTextOk: a valid object is safe", M.configTextOk('{"rounds": 4}') === true);
check("configTextOk: invalid JSON is not safe", M.configTextOk("{oops") === false);
check("configTextOk: a JSON array is not safe", M.configTextOk('[1, 2]') === false);
check("configTextOk: a JSON string is not safe", M.configTextOk('"hello"') === false);
check("configTextOk: truncated JSON is not safe", M.configTextOk('{"rounds": 4') === false);
// --- Obsidian sync (Phase 6) ---
var SAMPLE_LOG_JSON = '[{"date":"2026-11-11","tag":"Work","minutes":25},{"date":"2026-11-11","tag":"Art","minutes":15}]';
check("focusLogText: header marks the note generated", M.focusLogText("").indexOf("generated") !== -1);
check("focusLogText: header has the table columns", M.focusLogText("").indexOf("| Date | Tag | Minutes |") !== -1);
check("focusLogText: empty log is just the header", M.focusLogText("").trim() === M.FOCUS_LOG_HEADER.trim());
check("focusLogText: rows are one per block", M.focusLogText(SAMPLE_LOG_JSON).indexOf("| 2026-11-11 | Work | 25 |") !== -1 && M.focusLogText(SAMPLE_LOG_JSON).indexOf("| 2026-11-11 | Art | 15 |") !== -1);
check("focusLogText: a retag changes the vault row", M.focusLogText(M.retagSessionLog(SAMPLE_LOG_JSON, "Study")).indexOf("| 2026-11-11 | Study | 15 |") !== -1 && M.focusLogText(M.retagSessionLog(SAMPLE_LOG_JSON, "Study")).indexOf("| Art |") === -1);
check("focusLogText: a pipe in a tag cannot break the table", M.focusLogText('[{"date":"2026-11-11","tag":"A|B","minutes":25}]').indexOf("| A/B |") !== -1);
check("focusLogText: an invalid log is just the header", M.focusLogText("{oops").trim() === M.FOCUS_LOG_HEADER.trim());
// --- Log export: CSV by extension (1.10.0) ---
check("focusLogFormat: .csv is csv", M.focusLogFormat("/home/aven/focus.csv") === "csv");
check("focusLogFormat: .CSV is csv (any case)", M.focusLogFormat("/home/aven/Focus.CSV") === "csv");
check("focusLogFormat: .md is md", M.focusLogFormat("/home/aven/Focus Log.md") === "md");
check("focusLogFormat: no extension is md", M.focusLogFormat("/home/aven/focus-log") === "md");
check("focusLogFormat: empty path is md", M.focusLogFormat("") === "md");
check("focusLogCsvText: header is the column row with Source", M.focusLogCsvText("").split("\n")[0] === "Date,Tag,Minutes,Source");
check("focusLogCsvText: rows are one per block with Source", M.focusLogCsvText(SAMPLE_LOG_JSON).indexOf("2026-11-11,Work,25,OmaPomodorchy") !== -1 && M.focusLogCsvText(SAMPLE_LOG_JSON).indexOf("2026-11-11,Art,15,OmaPomodorchy") !== -1);
check("focusLogCsvText: empty log is just the header", M.focusLogCsvText("").trim() === M.FOCUS_LOG_CSV_HEADER);
check("focusLogCsvText: an invalid log is just the header", M.focusLogCsvText("{oops").trim() === M.FOCUS_LOG_CSV_HEADER);
check("focusLogCsvText: a comma in a tag is quoted", M.focusLogCsvText('[{"date":"2026-11-11","tag":"A,B","minutes":25}]').indexOf('"A,B"') !== -1);
check("focusLogCsvText: a quote in a tag is doubled and quoted", M.focusLogCsvText('[{"date":"2026-11-11","tag":"A\\"B","minutes":25}]').indexOf('"A""B"') !== -1);
check("focusLogCsvText: a retag changes the csv row", M.focusLogCsvText(M.retagSessionLog(SAMPLE_LOG_JSON, "Study")).indexOf("2026-11-11,Study,15,OmaPomodorchy") !== -1 && M.focusLogCsvText(M.retagSessionLog(SAMPLE_LOG_JSON, "Study")).indexOf(",Art,") === -1);
// Formula injection (Iolite review, PR #13): a tag starting with =, +,
// -, @, tab, or CR is prefixed with a single quote so a spreadsheet
// treats it as text instead of running it as a formula.
check("focusLogCsvText: a tag starting with = is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"=2+2","minutes":25}]').indexOf("'=2+2") !== -1);
check("focusLogCsvText: a tag starting with + is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"+2","minutes":25}]').indexOf("'+2") !== -1);
check("focusLogCsvText: a tag starting with - is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"-2","minutes":25}]').indexOf("'-2") !== -1);
check("focusLogCsvText: a tag starting with @ is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"@SUM(A1)","minutes":25}]').indexOf("'@SUM(A1)") !== -1);
check("focusLogCsvText: a tag starting with a tab is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"\\tcmd","minutes":25}]').indexOf("'\tcmd") !== -1);
check("focusLogCsvText: a tag starting with CR is quote-prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"\\rcmd","minutes":25}]').indexOf("'\rcmd") !== -1);
check("focusLogCsvText: a plain tag is not prefixed", M.focusLogCsvText('[{"date":"2026-11-11","tag":"Work","minutes":25}]').indexOf("2026-11-11,Work,25,") !== -1);
var FOCUS_CMD = M.focusLogCommand("/x/write-config", "/home/aven/Projects/Obsidian/Aventurine/20_Practices/Focus/Focus Log.md");
check("focusLogCommand: starts with sh -c", FOCUS_CMD[0] === "sh" && FOCUS_CMD[1] === "-c");
check("focusLogCommand: mkdirs the parent dir then execs write-config --create", FOCUS_CMD[2].indexOf('mkdir -p "$(dirname "$1")"') !== -1 && FOCUS_CMD[2].indexOf('exec bash "$2" --create "$1"') !== -1);
check("focusLogCommand: path and script are positional args; the table is not an argument", FOCUS_CMD.length === 6 && FOCUS_CMD[4] === "/home/aven/Projects/Obsidian/Aventurine/20_Practices/Focus/Focus Log.md" && FOCUS_CMD[5] === "/x/write-config");
check("focusLogCommand: a relative path is null", M.focusLogCommand("/x/write-config", "Focus Log.md") === null);
check("focusLogCommand: an empty path is null", M.focusLogCommand("/x/write-config", "") === null);
// Overwrite guard (Iolite review, PR #7; rename fallback, PR #9): an
// existing file is only replaced when it starts with the generated
// header. The marker is name-independent ("This note is generated
// from"), with the pre-rename string as a fallback, so an old-header
// Focus Log is still recognised as generated. A skipped write exits
// with FOCUS_LOG_GUARD_SKIP_EXIT (2), not 0, so the caller can tell a
// skip from a successful write and log it (guard-log follow-up).
check("focusLogCommand: guard checks the existing file for the generated marker", FOCUS_CMD[2].indexOf('[ -s "$1" ]') !== -1 && FOCUS_CMD[2].indexOf("grep -qE") !== -1 && FOCUS_CMD[2].indexOf("This note is generated from") !== -1 && FOCUS_CMD[2].indexOf("Sessions logged by OmoPomodorachy") !== -1 && FOCUS_CMD[2].indexOf("exit 2") !== -1);
check("focusLogCommand: guard also accepts the format-specific CSV header row", FOCUS_CMD[2].indexOf("^Date,Tag,Minutes,Source") !== -1);
check("focusLogSkipMessage: names the target path and the reason, no file contents", M.focusLogSkipMessage("/x/Focus Log.md").indexOf("/x/Focus Log.md") !== -1 && M.focusLogSkipMessage("/x/Focus Log.md").indexOf("not a generated Focus Log") !== -1);
// Run the real argv against a stub write-config: a missing file is
// written, a generated file is rewritten, a hand-written file is left
// alone. The stub stands in for write-config --create (path; framed content on stdin).
var guardDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-log-guard-"));
var stubPath = path.join(guardDir, "write-config");
fs.writeFileSync(stubPath, "#!/usr/bin/env bash\nif [ \"$1\" = \"--create\" ]; then shift; fi\nread -r n\nhead -c \"$n\" > \"$1\"\n");
fs.chmodSync(stubPath, 0o755);
var guardTarget = path.join(guardDir, "Focus Log.md");
function runFocusLog(content) {
  var argv = M.focusLogCommand(stubPath, guardTarget);
  // spawnSync (not execFileSync): a guard skip exits 2, which must not
  // throw — the exit code is the signal the Service logs on.
  var res = require("child_process").spawnSync(argv[0], argv.slice(1), { input: writeConfigInput(content), stdio: ["pipe", "ignore", "ignore"] });
  return res.status;
}
check("focusLogCommand guard: a missing file is written (exit 0)", runFocusLog(M.focusLogText("")) === 0 && fs.readFileSync(guardTarget, "utf8") === M.focusLogText(""));
check("focusLogCommand guard: a generated file is rewritten (exit 0)", runFocusLog(M.focusLogText(SAMPLE_LOG_JSON)) === 0 && fs.readFileSync(guardTarget, "utf8") === M.focusLogText(SAMPLE_LOG_JSON));
// An old-header file (pre-rename "OmoPomodorachy" marker) is still
// recognised as generated and gets rewritten, not left behind.
var OLD_HEADER = M.FOCUS_LOG_HEADER.replace("OmaPomodorchy", "OmoPomodorachy");
fs.writeFileSync(guardTarget, OLD_HEADER + "\n");
check("focusLogCommand guard: an old-header file is rewritten (exit 0)", runFocusLog(M.focusLogText(SAMPLE_LOG_JSON)) === 0 && fs.readFileSync(guardTarget, "utf8") === M.focusLogText(SAMPLE_LOG_JSON));
fs.writeFileSync(guardTarget, "# My own notes\n\nDo not overwrite.\n");
check("focusLogCommand guard: a hand-written file is left alone (exit 2)", runFocusLog(M.focusLogText(SAMPLE_LOG_JSON)) === M.FOCUS_LOG_GUARD_SKIP_EXIT && fs.readFileSync(guardTarget, "utf8") === "# My own notes\n\nDo not overwrite.\n");
// A first Focus Log write killed after --create leaves a zero-byte file.
// It holds nothing to guard, so the next export replaces it (the guard used
// to refuse it forever).
fs.writeFileSync(guardTarget, "");
check("focusLogCommand guard: an empty file left by a killed first write is replaced (exit 0)", runFocusLog(M.focusLogText(SAMPLE_LOG_JSON)) === 0 && fs.readFileSync(guardTarget, "utf8") === M.focusLogText(SAMPLE_LOG_JSON));
// writeSucceeded (Service's write queue): a watchdog-killed write fails even
// when the process reports exit 0.
var WRITE_OK = new Function(src + "\nreturn { writeSucceeded };")().writeSucceeded;
check("writeSucceeded: exit 0 and not killed succeeds", WRITE_OK(0, false) === true);
check("writeSucceeded: a timed-out write fails even at exit 0", WRITE_OK(0, true) === false);
check("writeSucceeded: a non-zero exit fails", WRITE_OK(1, false) === false && WRITE_OK(2, false) === false);
check("writeSucceeded: a timed-out write fails at a non-zero exit too", WRITE_OK(137, true) === false);
fs.rmSync(guardDir, { recursive: true, force: true });

// CSV guard stub (Iolite review, PR #13): same argv, CSV target. A
// generated CSV (with the Source marker column) is rewritten; a
// hand-written CSV with a plain Date,Tag,Minutes header is left alone.
var csvGuardDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-log-csv-guard-"));
var csvStubPath = path.join(csvGuardDir, "write-config");
fs.writeFileSync(csvStubPath, "#!/usr/bin/env bash\nif [ \"$1\" = \"--create\" ]; then shift; fi\nread -r n\nhead -c \"$n\" > \"$1\"\n");
fs.chmodSync(csvStubPath, 0o755);
var csvGuardTarget = path.join(csvGuardDir, "focus-log.csv");
function runFocusLogCsv(content) {
  var argv = M.focusLogCommand(csvStubPath, csvGuardTarget);
  var res = require("child_process").spawnSync(argv[0], argv.slice(1), { input: writeConfigInput(content), stdio: ["pipe", "ignore", "ignore"] });
  return res.status;
}
check("focusLogCommand CSV guard: a missing file is written (exit 0)", runFocusLogCsv(M.focusLogCsvText("")) === 0 && fs.readFileSync(csvGuardTarget, "utf8") === M.focusLogCsvText(""));
check("focusLogCommand CSV guard: a generated CSV is rewritten (exit 0)", runFocusLogCsv(M.focusLogCsvText(SAMPLE_LOG_JSON)) === 0 && fs.readFileSync(csvGuardTarget, "utf8") === M.focusLogCsvText(SAMPLE_LOG_JSON));
fs.writeFileSync(csvGuardTarget, "Date,Tag,Minutes\n2026-11-11,Work,25\n");
check("focusLogCommand CSV guard: a hand-written CSV is left alone (exit 2)", runFocusLogCsv(M.focusLogCsvText(SAMPLE_LOG_JSON)) === M.FOCUS_LOG_GUARD_SKIP_EXIT && fs.readFileSync(csvGuardTarget, "utf8") === "Date,Tag,Minutes\n2026-11-11,Work,25\n");
fs.rmSync(csvGuardDir, { recursive: true, force: true });

// --- Presets: list, switch, save as ---
var PRESET_TOML = 'active_preset = "pomodoro"\n\n[presets.pomodoro]\nwork_minutes = 25\nshort_break_minutes = 5\nlong_break_minutes = 15\nsessions_before_long_break = 4\n\n[presets.deep_work]\nwork_minutes = 50\nshort_break_minutes = 10\nlong_break_minutes = 30\nsessions_before_long_break = 4\n';
check("listPresets: pomodoro first, in file order", JSON.stringify(M.listPresets(PRESET_TOML)) === JSON.stringify(["pomodoro", "deep_work"]));
check("listPresets: no sections is empty", M.listPresets('active_preset = "pomodoro"\n').length === 0);
check("setActivePreset: switches to deep_work", M.setActivePreset(PRESET_TOML, "deep_work").indexOf('active_preset = "deep_work"') !== -1);
check("setActivePreset: unknown name is null", M.setActivePreset(PRESET_TOML, "nope") === null);
check("validPresetName: good names pass, spaces fail", M.validPresetName("study") === "study" && M.validPresetName("my preset") === null && M.validPresetName("") === null);
var saved = M.savePresetAs(PRESET_TOML, "study", 45, 10, 20);
check("savePresetAs: creates the section and makes it active", saved !== null && saved.indexOf("[presets.study]") !== -1 && saved.indexOf("work_minutes = 45") !== -1 && saved.indexOf('active_preset = "study"') !== -1 && M.listPresets(saved).indexOf("study") !== -1);
var savedOver = M.savePresetAs(PRESET_TOML, "pomodoro", 30, 5, 15);
check("savePresetAs: overwriting an existing preset updates it in place", savedOver !== null && M.parseDurations(savedOver).work === 30 && M.listPresets(savedOver).length === 2);
check("savePresetAs: a bad name is null", M.savePresetAs(PRESET_TOML, "my preset", 45, 10, 20) === null);

// --- Tags: add and remove ---
check("addTag: adds a new tag", JSON.stringify(M.addTag(["Work", "Study"], "Art")) === JSON.stringify(["Work", "Study", "Art"]));
check("addTag: a duplicate or empty name is null", M.addTag(["Work"], "Work") === null && M.addTag(["Work"], "  ") === null);
check("addTag: a pipe in a name is null", M.addTag(["Work"], "A|B") === null);
check("removeTag: removes the tag", JSON.stringify(M.removeTag(["Work", "Study", "Art"], "Study")) === JSON.stringify(["Work", "Art"]));
check("removeTag: unknown tag or the last tag is null", M.removeTag(["Work"], "Study") === null && M.removeTag(["Work"], "Work") === null);

// --- Tag schedule: queue, presets ---
check("enqueueTag: appends a known tag", JSON.stringify(M.enqueueTag(["Work"], "Study", ["Work", "Study"])) === JSON.stringify(["Work", "Study"]));
check("enqueueTag: an unknown tag is null", M.enqueueTag([], "Nope", ["Work"]) === null);
check("removeScheduledTag: removes by index", JSON.stringify(M.removeScheduledTag(["Work", "Study", "Art"], 1)) === JSON.stringify(["Work", "Art"]));
check("removeScheduledTag: a bad index is null", M.removeScheduledTag(["Work"], 5) === null);
var shifted = M.shiftSchedule(["Work", "Study"]);
check("shiftSchedule: takes the front tag", shifted !== null && shifted.tag === "Work" && JSON.stringify(shifted.schedule) === JSON.stringify(["Study"]));
check("shiftSchedule: an empty queue is null", M.shiftSchedule([]) === null);
var shiftedSkip = M.shiftSchedule(["Gone", "Work", "Study"], ["Work", "Study", "Art"]);
check("shiftSchedule: skips a deleted tag at the front", shiftedSkip !== null && shiftedSkip.tag === "Work" && JSON.stringify(shiftedSkip.schedule) === JSON.stringify(["Study"]));
check("shiftSchedule: all-unknown queue is null", M.shiftSchedule(["Gone", "AlsoGone"], ["Work", "Study"]) === null);
check("filterSchedule: drops deleted tags, keeps the rest", JSON.stringify(M.filterSchedule(["Work", "Gone", "Study"], ["Work", "Study", "Art"])) === JSON.stringify(["Work", "Study"]));
check("filterSchedule: an empty or all-unknown queue is empty", JSON.stringify(M.filterSchedule(["Gone"], ["Work"])) === JSON.stringify([]) && JSON.stringify(M.filterSchedule([], ["Work"])) === JSON.stringify([]));
var schedPresets = M.saveSchedulePreset({}, "Morning", ["Work", "Study", "Art"]);
check("saveSchedulePreset: saves under the name", schedPresets !== null && JSON.stringify(schedPresets.Morning) === JSON.stringify(["Work", "Study", "Art"]));
check("saveSchedulePreset: a duplicate name or empty queue is null", M.saveSchedulePreset(schedPresets, "Morning", ["Work"]) === null && M.saveSchedulePreset({}, "Empty", []) === null);
check("loadSchedulePreset: returns the saved queue", JSON.stringify(M.loadSchedulePreset(schedPresets, "Morning")) === JSON.stringify(["Work", "Study", "Art"]));
check("loadSchedulePreset: an unknown name is null", M.loadSchedulePreset(schedPresets, "Nope") === null);
check("deleteSchedulePreset: removes the preset", JSON.stringify(M.deleteSchedulePreset(schedPresets, "Morning")) === JSON.stringify({}));
check("deleteSchedulePreset: an unknown name is null", M.deleteSchedulePreset(schedPresets, "Nope") === null);

// --- View log URL (Service.openLog → Model.fileUrl) ---
// "#" and "?" start the fragment and query of a URL, so they are escaped; a
// space and a "%" are escaped by encodeURI as before.
const FILE_URL = new Function(src + "\nreturn { fileUrl };")();
check("fileUrl: a plain path is file:// plus the path", FILE_URL.fileUrl("/home/aven/notes.md") === "file:///home/aven/notes.md");
check("fileUrl: a space is escaped", FILE_URL.fileUrl("/home/aven/Focus Log.md") === "file:///home/aven/Focus%20Log.md");
check("fileUrl: a # is escaped, not read as a fragment", FILE_URL.fileUrl("/home/aven/Focus #2.md") === "file:///home/aven/Focus%20%232.md");
check("fileUrl: a ? is escaped, not read as a query", FILE_URL.fileUrl("/home/aven/what?.csv") === "file:///home/aven/what%3F.csv");
check("fileUrl: a % is escaped once", FILE_URL.fileUrl("/home/aven/100%.md") === "file:///home/aven/100%25.md");

// --- Sessions log edits: applied to a fresh read, never to the poll copy ---
// Service.queueSessionEdit → applySessionEdit. SE_POLLED is what the last
// poll read; SE_EXTERNAL is the file when the block ends, after an outside
// writer changed it between polls. The edit must keep the outside change.
const SE = new Function(src + "\nreturn { applySessionEdit, sessionLogTextOk, sessionEditSkipMessage, wellFormedUtf8 };")();
const SE_CAP = 1048576;
const SE_WORK = { date: "2026-11-17", tag: "Work", minutes: 25 };
const SE_ADMIN = { date: "2026-11-18", tag: "Admin", minutes: 10 };
const SE_BLOCK = { date: "2026-11-18", tag: "Study", minutes: 25 };
const SE_POLLED = JSON.stringify([SE_WORK]);
const SE_EXTERNAL = JSON.stringify([SE_WORK, SE_ADMIN]);
const seAppended = SE.applySessionEdit(SE_EXTERNAL, { kind: "append", entry: SE_BLOCK }, SE_CAP);
check("session edit: an append after an outside entry keeps that entry", seAppended.text !== undefined && M.parseSessionLog(seAppended.text).length === 3 && M.parseSessionLog(seAppended.text)[1].tag === "Admin");
check("session edit: the new block is appended last", seAppended.text !== undefined && M.parseSessionLog(seAppended.text)[2].tag === "Study" && M.parseSessionLog(seAppended.text)[2].minutes === 25);
check("session edit: appending to the poll copy would drop the outside entry (the stale write this prevents)", M.parseSessionLog(M.appendSessionLog(SE_POLLED, SE_BLOCK)).length === 2 && M.parseSessionLog(seAppended.text).length === 3);
const SE_REPLACED = JSON.stringify([{ date: "2026-11-18", tag: "Art", minutes: 40 }]);
const seReplaced = SE.applySessionEdit(SE_REPLACED, { kind: "append", entry: SE_BLOCK }, SE_CAP);
check("session edit: an outside replace between polls is what gets appended to", seReplaced.text !== undefined && M.parseSessionLog(seReplaced.text).length === 2 && M.parseSessionLog(seReplaced.text)[0].tag === "Art" && M.parseSessionLog(seReplaced.text)[1].tag === "Study");
const seEmptied = SE.applySessionEdit("", { kind: "append", entry: SE_BLOCK }, SE_CAP);
check("session edit: a missing or emptied file gets the block alone", seEmptied.text !== undefined && M.parseSessionLog(seEmptied.text).length === 1);
const SE_PARTIAL = ['{"date":', "{}", '"text"', "[1,"];
check("session edit: a partial write or a non-array is skipped, never replaced by one entry", SE_PARTIAL.every((t) => SE.applySessionEdit(t, { kind: "append", entry: SE_BLOCK }, SE_CAP).skip !== undefined));
check("sessionLogTextOk: empty and an array are safe to write over; an object and broken JSON are not", SE.sessionLogTextOk("") && SE.sessionLogTextOk("[]") && !SE.sessionLogTextOk("{}") && !SE.sessionLogTextOk("{oops"));
const seRetagged = SE.applySessionEdit(SE_EXTERNAL, { kind: "retag", tag: "Art", expect: SE_ADMIN }, SE_CAP);
check("session edit retag: the block shown is still last, so its tag changes and the others stay", seRetagged.text !== undefined && M.parseSessionLog(seRetagged.text)[1].tag === "Art" && M.parseSessionLog(seRetagged.text)[0].tag === "Work");
const seMoved = SE.applySessionEdit(seAppended.text, { kind: "retag", tag: "Art", expect: SE_ADMIN }, SE_CAP);
check("session edit retag: a block added after the shown one is not retagged", seMoved.skip !== undefined && seMoved.text === undefined);
check("session edit retag: an empty tag or an empty file is skipped", SE.applySessionEdit(SE_EXTERNAL, { kind: "retag", tag: "", expect: SE_ADMIN }, SE_CAP).skip !== undefined && SE.applySessionEdit("", { kind: "retag", tag: "Art", expect: SE_ADMIN }, SE_CAP).skip !== undefined);
const seChained = SE.applySessionEdit(seAppended.text, { kind: "retag", tag: "Art", expect: SE_BLOCK }, SE_CAP);
check("session edit batch: a retag of the block appended first applies to the same text", seChained.text !== undefined && M.parseSessionLog(seChained.text)[2].tag === "Art" && M.parseSessionLog(seChained.text).length === 3);
const seEntryJson = (tag) => JSON.stringify([{ date: "2026-11-18", tag: tag, minutes: 25 }]);
const seBase = Buffer.byteLength(seEntryJson(""));
const seFit = Math.floor((SE_CAP - seBase) / 2);
const seAtCap = SE.applySessionEdit("", { kind: "append", entry: { date: "2026-11-18", tag: "é".repeat(seFit), minutes: 25 } }, SE_CAP);
const seOverCap = SE.applySessionEdit("", { kind: "append", entry: { date: "2026-11-18", tag: "é".repeat(seFit + 1), minutes: 25 } }, SE_CAP);
check("session edit cap: a result within 1 MiB is written", seAtCap.text !== undefined && Buffer.byteLength(seAtCap.text) <= SE_CAP);
check("session edit cap: one more two-byte character over 1 MiB is skipped", seOverCap.skip !== undefined && seOverCap.text === undefined);
check("wellFormedUtf8: a lone surrogate counts as U+FFFD (3 bytes)", SE.wellFormedUtf8("\ud800").bytes === 3 && SE.wellFormedUtf8("\ud800").text === "\ufffd");
const seMsg = SE.sessionEditSkipMessage("/x/focusd-sessions.json", { kind: "retag" }, "the last block on disk is not the block shown");
check("sessionEditSkipMessage: names the file, the reason and that nothing was written", seMsg.indexOf("/x/focusd-sessions.json") !== -1 && seMsg.indexOf("the last block on disk") !== -1 && seMsg.indexOf("nothing written") !== -1 && seMsg.indexOf("tag change") !== -1);

// --- Guarded sessions write: framing, the conflict exit, the bounded retry ---
const SC = new Function(src + "\nreturn { writeConfigGuardedInput, writeConfigInput, FILE_CHANGED_EXIT, EDIT_MAX_CONFLICTS, retryConflictedEdits };")();
check("guarded input: the base frame, then the content frame", SC.writeConfigGuardedInput("ab", "é") === "2\nab2\né");
check("guarded input: an empty base is a zero-count frame", SC.writeConfigGuardedInput("", "x") === "0\n1\nx");
check("guarded input: each frame counts its own UTF-8 bytes", SC.writeConfigGuardedInput("😀", "é") === "4\n😀" + "2\né");
check("guarded input: the base frame is the single-frame framing", SC.writeConfigGuardedInput("ab", "c").indexOf(SC.writeConfigInput("ab")) === 0);
check("FILE_CHANGED_EXIT is 3, write-config's conflict exit", SC.FILE_CHANGED_EXIT === 3);
const rEdit = { kind: "append", entry: SE_BLOCK };
const r1 = SC.retryConflictedEdits([rEdit]);
check("retry: a first conflict is retried, marked with one conflict", r1.retry.length === 1 && r1.dropped.length === 0 && r1.retry[0].conflicts === 1 && r1.retry[0].kind === "append");
check("retry: the input edit object is not changed", rEdit.conflicts === undefined && r1.retry[0] !== rEdit);
const r2 = SC.retryConflictedEdits([{ kind: "append", entry: SE_BLOCK, conflicts: SC.EDIT_MAX_CONFLICTS - 1 }]);
check("retry: an edit at the conflict limit is dropped", r2.retry.length === 0 && r2.dropped.length === 1 && r2.dropped[0].conflicts === SC.EDIT_MAX_CONFLICTS);
check("retry: no edits, or a non-array, give nothing to retry", SC.retryConflictedEdits(undefined).retry.length === 0 && SC.retryConflictedEdits([]).dropped.length === 0);


console.log(`FocusdModel tests: ${pass} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
