// Node harness for FocusdModel.js. Run: node test/FocusdModel.test.js
// The QML service is reviewed by diff and verified on dooracle instead.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const src = fs.readFileSync(path.join(__dirname, "..", "FocusdModel.js"), "utf8");
const factory = new Function(
  src + "\nreturn { FREEDESKTOP_SOUNDS, DEFAULT_SOUND, resolveSoundFile, chimeCommand, sessionEnded, shouldChime, isBreakSession, breatherCommand, parseMinutes, shouldLaunchBreather, DURATION_LIMITS, clampDuration, parseDurations, updateDuration, clampRounds, workSessionEnded, shouldStopAfterRound, DEFAULT_TAGS, parseTags, parseSeconds, elapsedMinutes, parseSessionLog, appendSessionLog, retagSessionLog, nextTag, setJsonKey, configTextOk, FOCUS_LOG_HEADER, focusLogText, focusLogCommand };"
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

// --- Rounds setting (GUI) ---
check("setJsonKey: sets a key in existing JSON", JSON.parse(M.setJsonKey('{"rounds": 0, "tags": ["Work"]}', "rounds", 4)).rounds === 4);
check("setJsonKey: keeps the other keys", JSON.parse(M.setJsonKey('{"rounds": 0, "tags": ["Work"]}', "rounds", 4)).tags[0] === "Work");
check("setJsonKey: an empty file starts fresh", JSON.parse(M.setJsonKey("", "rounds", 4)).rounds === 4);
check("setJsonKey: an invalid file starts fresh", JSON.parse(M.setJsonKey("{oops", "rounds", 4)).rounds === 4);
check("setJsonKey: output is indented JSON", M.setJsonKey("", "rounds", 4).indexOf('\n  "rounds": 4') !== -1);

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
var FOCUS_CMD = M.focusLogCommand("/x/write-config", "/home/aven/Projects/Obsidian/Home/20_Practices/Focus/Focus Log.md", "TABLE");
check("focusLogCommand: starts with sh -c", FOCUS_CMD[0] === "sh" && FOCUS_CMD[1] === "-c");
check("focusLogCommand: mkdirs the parent dir then execs write-config --create", FOCUS_CMD[2].indexOf('mkdir -p "$(dirname "$1")"') !== -1 && FOCUS_CMD[2].indexOf('exec bash "$2" --create "$1" "$3"') !== -1);
check("focusLogCommand: path, script and table are positional args", FOCUS_CMD[4] === "/home/aven/Projects/Obsidian/Home/20_Practices/Focus/Focus Log.md" && FOCUS_CMD[5] === "/x/write-config" && FOCUS_CMD[6] === "TABLE");
check("focusLogCommand: a relative path is null", M.focusLogCommand("/x/write-config", "Focus Log.md", "TABLE") === null);
check("focusLogCommand: an empty path is null", M.focusLogCommand("/x/write-config", "", "TABLE") === null);
// Overwrite guard (Iolite review, PR #7; rename fallback, PR #9): an
// existing file is only replaced when it starts with the generated
// header. The marker is name-independent ("This note is generated
// from"), with the pre-rename string as a fallback, so an old-header
// Focus Log is still recognised as generated.
check("focusLogCommand: guard checks the existing file for the generated marker", FOCUS_CMD[2].indexOf('[ -e "$1" ]') !== -1 && FOCUS_CMD[2].indexOf("grep -qE") !== -1 && FOCUS_CMD[2].indexOf("This note is generated from") !== -1 && FOCUS_CMD[2].indexOf("Sessions logged by OmoPomodorachy") !== -1 && FOCUS_CMD[2].indexOf("exit 0") !== -1);
// Run the real argv against a stub write-config: a missing file is
// written, a generated file is rewritten, a hand-written file is left
// alone. The stub stands in for write-config --create (path, content).
var guardDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-log-guard-"));
var stubPath = path.join(guardDir, "write-config");
fs.writeFileSync(stubPath, "#!/usr/bin/env bash\nif [ \"$1\" = \"--create\" ]; then shift; fi\nprintf '%s' \"$2\" > \"$1\"\n");
fs.chmodSync(stubPath, 0o755);
var guardTarget = path.join(guardDir, "Focus Log.md");
function runFocusLog(content) {
  var argv = M.focusLogCommand(stubPath, guardTarget, content);
  execFileSync(argv[0], argv.slice(1), { stdio: "ignore" });
}
runFocusLog(M.focusLogText(""));
check("focusLogCommand guard: a missing file is written", fs.readFileSync(guardTarget, "utf8") === M.focusLogText(""));
runFocusLog(M.focusLogText(SAMPLE_LOG_JSON));
check("focusLogCommand guard: a generated file is rewritten", fs.readFileSync(guardTarget, "utf8") === M.focusLogText(SAMPLE_LOG_JSON));
// An old-header file (pre-rename "OmoPomodorachy" marker) is still
// recognised as generated and gets rewritten, not left behind.
var OLD_HEADER = M.FOCUS_LOG_HEADER.replace("OmaPomodorchy", "OmoPomodorachy");
fs.writeFileSync(guardTarget, OLD_HEADER + "\n");
runFocusLog(M.focusLogText(SAMPLE_LOG_JSON));
check("focusLogCommand guard: an old-header file is rewritten", fs.readFileSync(guardTarget, "utf8") === M.focusLogText(SAMPLE_LOG_JSON));
fs.writeFileSync(guardTarget, "# My own notes\n\nDo not overwrite.\n");
runFocusLog(M.focusLogText(SAMPLE_LOG_JSON));
check("focusLogCommand guard: a hand-written file is left alone", fs.readFileSync(guardTarget, "utf8") === "# My own notes\n\nDo not overwrite.\n");
fs.rmSync(guardDir, { recursive: true, force: true });

console.log(`FocusdModel tests: ${pass} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
