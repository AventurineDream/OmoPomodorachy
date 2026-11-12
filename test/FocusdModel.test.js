// Node harness for FocusdModel.js. Run: node test/FocusdModel.test.js
// The QML service is reviewed by diff and verified on dooracle instead.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const src = fs.readFileSync(path.join(__dirname, "..", "FocusdModel.js"), "utf8");
const factory = new Function(
  src + "\nreturn { FREEDESKTOP_SOUNDS, DEFAULT_SOUND, resolveSoundFile, chimeCommand, sessionEnded, shouldChime, isBreakSession, breatherCommand, parseMinutes, shouldLaunchBreather, DURATION_LIMITS, clampDuration, parseDurations, updateDurations };"
);
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
check("breatherCommand argv", bc[0] === "omarchy-shell" && bc[1] === "shell" && bc[2] === "summon" && bc[3] === "luotao.zen");
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

const updated = M.updateDurations(SAMPLE_TOML, 45, 8, 20);
check("updateDurations returns text", typeof updated === "string");
const reparsed = M.parseDurations(updated);
check("updateDurations writes work", reparsed && reparsed.work === 45);
check("updateDurations writes short break", reparsed && reparsed.shortBreak === 8);
check("updateDurations writes long break", reparsed && reparsed.longBreak === 20);
check("updateDurations leaves deep_work alone", updated.includes("work_minutes = 50") && updated.includes("short_break_minutes = 10") && updated.includes("long_break_minutes = 30"));
check("updateDurations preserves comments and other keys", updated.includes("# Which preset is currently active") && updated.includes("daily_goal_minutes = 0") && updated.includes("sessions_before_long_break = 4"));
check("updateDurations preserves the commented preset", updated.includes("# [presets.study]") && updated.includes("# work_minutes = 45"));
check("updateDurations clamps work to 90", M.parseDurations(M.updateDurations(SAMPLE_TOML, 200, 5, 15)).work === 90);
check("updateDurations clamps short break to 1", M.parseDurations(M.updateDurations(SAMPLE_TOML, 25, 0, 15)).shortBreak === 1);
check("updateDurations clamps long break to 60", M.parseDurations(M.updateDurations(SAMPLE_TOML, 25, 5, 999)).longBreak === 60);
check("updateDurations: missing preset is null", M.updateDurations(SAMPLE_TOML.replace('[presets.pomodoro]', "[presets.other]"), 45, 8, 20) === null);
check("updateDurations: non-numeric value is null", M.updateDurations(SAMPLE_TOML, "abc", 5, 15) === null);
check("updateDurations: missing key is null", M.updateDurations(SAMPLE_TOML.replace("long_break_minutes = 15\n", ""), 45, 8, 20) === null);

// An out-of-range preset value is left alone unless that slider moves.
const OUT_OF_RANGE_TOML = SAMPLE_TOML.replace("work_minutes = 25", "work_minutes = 120").replace("long_break_minutes = 15", "long_break_minutes = 2");
const oor = M.parseDurations(OUT_OF_RANGE_TOML);
check("out-of-range values parse", oor && oor.work === 120 && oor.longBreak === 2);
const oorMovedShort = M.updateDurations(OUT_OF_RANGE_TOML, 120, 8, 2);
check("moving short break leaves a 120-min work value alone", oorMovedShort !== null && M.parseDurations(oorMovedShort).work === 120 && M.parseDurations(oorMovedShort).shortBreak === 8);
check("moving short break leaves a 2-min long break alone", oorMovedShort !== null && M.parseDurations(oorMovedShort).longBreak === 2);
const oorMovedWork = M.updateDurations(OUT_OF_RANGE_TOML, 45, 5, 2);
check("moving work rewrites only work", oorMovedWork !== null && M.parseDurations(oorMovedWork).work === 45 && M.parseDurations(oorMovedWork).longBreak === 2);
const oorUnchanged = M.updateDurations(OUT_OF_RANGE_TOML, 120, 5, 2);
check("no change means the text is untouched", oorUnchanged === OUT_OF_RANGE_TOML);

check("clampDuration work 5..90", M.clampDuration("work", 4) === 5 && M.clampDuration("work", 91) === 90 && M.clampDuration("work", 25) === 25);
check("clampDuration short 1..30", M.clampDuration("shortBreak", 0) === 1 && M.clampDuration("shortBreak", 31) === 30);
check("clampDuration long 5..60", M.clampDuration("longBreak", 4) === 5 && M.clampDuration("longBreak", 61) === 60);
check("clampDuration rounds", M.clampDuration("work", 25.6) === 26);
check("clampDuration unknown kind is null", M.clampDuration("nope", 5) === null);
check("clampDuration non-numeric is null", M.clampDuration("work", "abc") === null);

console.log(`FocusdModel tests: ${pass} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
