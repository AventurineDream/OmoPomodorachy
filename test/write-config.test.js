// Node harness for write-config, run for real (not a stub), and for the
// stdin framing it reads (FocusdModel.js writeConfigInput). Run:
//   node test/write-config.test.js
// Regression: the sessions log and the Focus Log grow past 128 KiB, the
// kernel's limit on one argv string (E2BIG). When content travelled as an
// argument, those writes failed silently. Content now goes on stdin, framed
// "<byte count>\n<content>", and the cap is 1 MiB counted in bytes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "write-config");
const src = fs.readFileSync(path.join(ROOT, "FocusdModel.js"), "utf8");
const M = new Function(
  src + "\nreturn { writeConfigInput, writeConfigGuardedInput, focusLogCommand, focusLogText, applyConfigEdits };"
)();

const ARG_STRING_LIMIT = 131072; // Linux MAX_ARG_STRLEN: one argv string must stay below this.
const CAP = 1048576; // write-config's content cap, in bytes.

let pass = 0;
function check(name, ok) {
  if (ok) {
    pass++;
  } else {
    process.exitCode = 1;
    console.error("FAIL:", name);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-config-test-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

// Run the real script. `stdin` is the raw framed input (string or Buffer).
function runScript(args, stdin) {
  return spawnSync("bash", [SCRIPT, ...args], {
    input: stdin,
    stdio: ["pipe", "ignore", "pipe"],
  });
}

// Write `content` the way the Service does: framed on stdin, --create by default.
function writeFramed(target, content, flags = ["--create"]) {
  return runScript([...flags, target], M.writeConfigInput(content));
}

// --- framing (what the script reads) ---
check("framing: ASCII count is the byte count", M.writeConfigInput("abc") === "3\nabc");
check("framing: a two-byte character counts two bytes", M.writeConfigInput("é") === "2\né");
check("framing: an astral character counts four bytes", M.writeConfigInput("😀") === "4\n😀");
check("framing: a lone surrogate is sent as U+FFFD (3 bytes)", M.writeConfigInput("\ud800") === "3\n\ufffd");
const mixed = 'tag "x" | a,b\n😀 é — end\n'.repeat(50);
check(
  "framing: the count is the UTF-8 byte length for well-formed text",
  M.writeConfigInput(mixed) === Buffer.byteLength(mixed) + "\n" + mixed
);

// --- the 128 KiB regression ---
const bigLog = [];
for (let i = 0; i < 6000; i++) bigLog.push({ date: "2026-11-18", tag: "Deep work", minutes: 25 });
const sessionsJson = JSON.stringify(bigLog);
const table = M.focusLogText(sessionsJson);
check("fixture: the sessions log is past 128 KiB", Buffer.byteLength(sessionsJson) > ARG_STRING_LIMIT);
check("fixture: the Focus Log table is past 128 KiB", Buffer.byteLength(table) > ARG_STRING_LIMIT);

const sessionsFile = path.join(dir, "focusd-sessions.json");
const sessionsWrite = writeFramed(sessionsFile, sessionsJson);
check("sessions: a 128 KiB+ log is written (exit 0)", sessionsWrite.status === 0);
check("sessions: the file holds the exact log", fs.readFileSync(sessionsFile, "utf8") === sessionsJson);

// The Focus Log export uses the argv the Service builds, with a path that
// has spaces and a parent folder that does not exist yet.
const logTarget = path.join(dir, "nested", "Focus Log.md");
const argv = M.focusLogCommand(SCRIPT, logTarget);
const exportRun = spawnSync(argv[0], argv.slice(1), {
  input: M.writeConfigInput(table),
  stdio: ["pipe", "ignore", "pipe"],
});
check("focus log: a 128 KiB+ export is written (exit 0)", exportRun.status === 0);
check("focus log: the export file holds the exact table", fs.existsSync(logTarget) && fs.readFileSync(logTarget, "utf8") === table);
check("focus log: no argv element reaches the kernel limit", argv.every((a) => Buffer.byteLength(a) < ARG_STRING_LIMIT));
check("focus log: the sessions write argv stays under the limit too", ["bash", SCRIPT, "--create", sessionsFile].every((a) => Buffer.byteLength(a) < ARG_STRING_LIMIT));

// A first Focus Log write killed after --create leaves a zero-byte file at the
// path. The guard must replace it; refusing it would block every later export.
function runFocusLogExport(target, text) {
  const a = M.focusLogCommand(SCRIPT, target);
  return spawnSync(a[0], a.slice(1), { input: M.writeConfigInput(text), stdio: ["pipe", "ignore", "pipe"] });
}
const killedLog = path.join(dir, "killed", "Focus Log.md");
fs.mkdirSync(path.dirname(killedLog));
fs.writeFileSync(killedLog, "");
check("focus log: a zero-byte file left by a killed first write is replaced (exit 0)", runFocusLogExport(killedLog, table).status === 0 && fs.readFileSync(killedLog, "utf8") === table);
const handLog = path.join(dir, "Hand Log.md");
fs.writeFileSync(handLog, "# mine\n");
check("focus log: a hand-written file with content is still refused (exit 2)", runFocusLogExport(handLog, table).status === 2 && fs.readFileSync(handLog, "utf8") === "# mine\n");

// --- the cap: 1 MiB in bytes, refused before the file is touched ---
const capFile = path.join(dir, "cap.json");
check("cap: exactly 1 MiB is accepted", writeFramed(capFile, "a".repeat(CAP)).status === 0 && fs.statSync(capFile).size === CAP);
const beforeOver = fs.readFileSync(capFile);
check("cap: 1 MiB + 1 byte is refused", writeFramed(capFile, "a".repeat(CAP + 1)).status !== 0);
check("cap: a refused write leaves the file as it was", fs.readFileSync(capFile).equals(beforeOver));
check("cap counts bytes: 524289 two-byte characters (over the cap) refused", writeFramed(capFile, "é".repeat(CAP / 2 + 1)).status !== 0 && fs.readFileSync(capFile).equals(beforeOver));
check("cap counts bytes: 524288 two-byte characters (exactly the cap) accepted", writeFramed(capFile, "é".repeat(CAP / 2)).status === 0 && fs.statSync(capFile).size === CAP);

// --- header validation: bad input is refused and the file is kept ---
const guard = path.join(dir, "guard.json");
const badInputs = [
  ["a non-digit header", "x3\nabc"],
  ["a signed header", "+3\nabc"],
  ["an empty header", "\nabc"],
  ["an over-long header", "1234567890\nabc"],
  ["a count longer than the content", "10\nabc"],
  ["content with no header", "abc"],
];
for (const [name, input] of badInputs) {
  fs.writeFileSync(guard, "keep");
  const res = runScript(["--create", guard], input);
  check(`header: ${name} is refused and the file is kept`, res.status !== 0 && fs.readFileSync(guard, "utf8") === "keep");
}

// An old caller that still passes the content as an argument is refused.
fs.writeFileSync(guard, "keep");
const oldArg = spawnSync("bash", [SCRIPT, "--create", guard, "new content"], { encoding: "utf8" });
check("argv: content passed as an argument is refused (exit 1)", oldArg.status === 1 && /stdin/.test(oldArg.stderr));
check("argv: the file is kept", fs.readFileSync(guard, "utf8") === "keep");

// --- create semantics ---
const missing = path.join(dir, "not-yet.json");
check("no --create: a missing file is refused and not created", writeFramed(missing, "{}", []).status !== 0 && !fs.existsSync(missing));
check("--create: a missing file is created", writeFramed(missing, "{}").status === 0 && fs.readFileSync(missing, "utf8") === "{}");
check("a relative path is refused", runScript(["--create", "write-config-rel.json"], M.writeConfigInput("x")).status !== 0 && !fs.existsSync("write-config-rel.json"));

// --- an existing file keeps its mode ---
const modeFile = path.join(dir, "private.json");
fs.writeFileSync(modeFile, "old");
fs.chmodSync(modeFile, 0o600);
writeFramed(modeFile, "new");
check("mode: an existing file keeps its mode (0600) and gets the new text", (fs.statSync(modeFile).mode & 0o777) === 0o600 && fs.readFileSync(modeFile, "utf8") === "new");

// --- a new file takes the umask (not a fixed 0644) ---
const umaskFile = path.join(dir, "umask.json");
const umaskRun = spawnSync("bash", ["-c", 'umask 027; exec bash "$0" --create "$1"', SCRIPT, umaskFile], { input: M.writeConfigInput("new") });
check("umask: a new file is created with the umask applied (0640 under umask 027)", umaskRun.status === 0 && (fs.statSync(umaskFile).mode & 0o777) === 0o640);

// --- symlinks are never followed ---
const realTarget = path.join(dir, "real.json");
fs.writeFileSync(realTarget, "real");
const link = path.join(dir, "link.json");
fs.symlinkSync(realTarget, link);
check("symlink: a symlinked file is refused and its target kept", writeFramed(link, "pwned").status !== 0 && fs.readFileSync(realTarget, "utf8") === "real");
const realDir = path.join(dir, "realdir");
fs.mkdirSync(realDir);
const linkDir = path.join(dir, "linkdir");
fs.symlinkSync(realDir, linkDir);
check("symlink: a file in a symlinked directory is refused", writeFramed(path.join(linkDir, "x.json"), "x").status !== 0 && !fs.existsSync(path.join(realDir, "x.json")));

// --- --expect: compare-before-replace for the sessions log ---
// Stdin is two frames: the expected current text, then the new text. The file
// is replaced only while its bytes equal the expected text; otherwise the
// script exits 3 (FILE_CHANGED_EXIT), writes nothing and keeps the file.
const CONFLICT = 3;
const guardedRun = (target, expected, content, flags = ["--create", "--expect"]) =>
  runScript([...flags, target], M.writeConfigGuardedInput(expected, content));
const tempsIn = (d) => fs.readdirSync(d).filter((n) => n.startsWith(".write-config-"));

const gFile = path.join(dir, "guarded.json");
fs.writeFileSync(gFile, "[1]");
check("expect: an unchanged target (bytes equal the base) is replaced (exit 0)", guardedRun(gFile, "[1]", "[2]").status === 0 && fs.readFileSync(gFile, "utf8") === "[2]");
fs.writeFileSync(gFile, '[1,{"hand":true}]');
check("expect: a changed target is kept and the write exits 3", guardedRun(gFile, "[1]", "[2]").status === CONFLICT && fs.readFileSync(gFile, "utf8") === '[1,{"hand":true}]');
check("expect: a conflict leaves no temp file behind", tempsIn(dir).length === 0);
fs.writeFileSync(gFile, "[1]\n");
check("expect: the compare is exact bytes (a trailing newline is a change)", guardedRun(gFile, "[1]", "[3]").status === CONFLICT && fs.readFileSync(gFile, "utf8") === "[1]\n");
fs.writeFileSync(gFile, "é 😀");
check("expect: a multi-byte base matches by bytes and is replaced", guardedRun(gFile, "é 😀", "ok").status === 0 && fs.readFileSync(gFile, "utf8") === "ok");
const gNew = path.join(dir, "guard-new.json");
check("expect: a missing target matches an empty base and is created (exit 0)", guardedRun(gNew, "", "[]").status === 0 && fs.readFileSync(gNew, "utf8") === "[]");
const gGone = path.join(dir, "guard-gone.json");
check("expect: a missing target does not match a non-empty base (exit 3), nothing created", guardedRun(gGone, "[1]", "[2]").status === CONFLICT && !fs.existsSync(gGone));
const gEmpty = path.join(dir, "guard-empty.json");
fs.writeFileSync(gEmpty, "");
check("expect: an empty target matches an empty base (a killed first write)", guardedRun(gEmpty, "", "[]").status === 0 && fs.readFileSync(gEmpty, "utf8") === "[]");
fs.writeFileSync(gEmpty, "x");
check("expect: a target with content against an empty base is a conflict (exit 3)", guardedRun(gEmpty, "", "[]").status === CONFLICT && fs.readFileSync(gEmpty, "utf8") === "x");
const gCap = path.join(dir, "guard-cap.json");
fs.writeFileSync(gCap, "a".repeat(CAP));
check("expect: a base of 1 MiB + 1 byte is refused (exit 1), the target kept", guardedRun(gCap, "a".repeat(CAP + 1), "x").status === 1 && fs.statSync(gCap).size === CAP);
check("expect: new content of 1 MiB + 1 byte is refused (exit 1), the target kept", guardedRun(gCap, "a".repeat(CAP), "a".repeat(CAP + 1)).status === 1 && fs.statSync(gCap).size === CAP);
check("expect: a base and new content of exactly 1 MiB are accepted", guardedRun(gCap, "a".repeat(CAP), "b".repeat(CAP)).status === 0 && fs.readFileSync(gCap, "utf8") === "b".repeat(CAP));
fs.writeFileSync(gFile, "[9]");
check("expect: a single frame (no base) is refused (exit 1), the target kept", runScript(["--create", "--expect", gFile], M.writeConfigInput("[8]")).status === 1 && fs.readFileSync(gFile, "utf8") === "[9]");
const gReal = path.join(dir, "guard-real.json");
fs.writeFileSync(gReal, "real");
const gLink = path.join(dir, "guard-link.json");
fs.symlinkSync(gReal, gLink);
check("expect: a symlinked target is refused and its target kept", guardedRun(gLink, "real", "pwned").status !== 0 && fs.readFileSync(gReal, "utf8") === "real");
const gMode = path.join(dir, "guard-mode.json");
fs.writeFileSync(gMode, "old");
fs.chmodSync(gMode, 0o600);
check("expect: an unchanged target keeps its mode (0600)", guardedRun(gMode, "old", "new").status === 0 && (fs.statSync(gMode).mode & 0o777) === 0o600);
check("options: an unknown option is refused and the target kept", runScript(["--bogus", gFile], M.writeConfigInput("x")).status === 1 && fs.readFileSync(gFile, "utf8") === "[9]");

// --- focusd.json: a hand-revoked export destination stays revoked ---
// Regression (marketplace review #15501). The panel read focusd.json with a
// focusLogPath; the user then removed it by hand. A key write built from the
// panel's stale copy must not land, and the write rebuilt from a fresh read
// must not carry the old path back.
const cfgFile = path.join(dir, "focusd.json");
const staleCfg = '{\n  "focusLogPath": "/home/u/old.md",\n  "rounds": 0\n}\n';
const handCfg = '{\n  "rounds": 0\n}\n';
fs.writeFileSync(cfgFile, handCfg);
const staleWrite = M.applyConfigEdits(staleCfg, [{ key: "rounds", value: 4 }]).text;
check("focusd.json: a write built from the stale copy conflicts (exit 3), the revocation kept", guardedRun(cfgFile, staleCfg, staleWrite).status === CONFLICT && fs.readFileSync(cfgFile, "utf8") === handCfg);
const freshWrite = M.applyConfigEdits(fs.readFileSync(cfgFile, "utf8"), [{ key: "rounds", value: 4 }]).text;
check("focusd.json: the retry from a fresh read lands without the revoked path", guardedRun(cfgFile, handCfg, freshWrite).status === 0 && JSON.parse(fs.readFileSync(cfgFile, "utf8")).rounds === 4 && !("focusLogPath" in JSON.parse(fs.readFileSync(cfgFile, "utf8"))));

console.log(`write-config tests: ${pass} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
