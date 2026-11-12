// Node harness for FocusdModel.js. Run: node test/FocusdModel.test.js
// The QML service is reviewed by diff and verified on dooracle instead.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const src = fs.readFileSync(path.join(__dirname, "..", "FocusdModel.js"), "utf8");
const factory = new Function(
  src + "\nreturn { FREEDESKTOP_SOUNDS, DEFAULT_SOUND, resolveSoundFile, chimeCommand, shouldChime };"
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
check("first poll never chimes", M.shouldChime("", "work", true) === false);
check("same session never chimes", M.shouldChime("work", "work", true) === false);
check("work to short break chimes", M.shouldChime("work", "short-break", true) === true);
check("short break to work chimes", M.shouldChime("short-break", "work", true) === true);
check("work to long break chimes", M.shouldChime("work", "long-break", true) === true);
check("long break to work chimes", M.shouldChime("long-break", "work", true) === true);
check("sounds off never chimes", M.shouldChime("work", "short-break", false) === false);
check("empty next session never chimes", M.shouldChime("work", "", true) === false);
check("pause keeps the session, so no chime", M.shouldChime("work", "work", true) === false);

console.log(`FocusdModel tests: ${pass} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
