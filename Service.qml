import QtQuick
import Quickshell
import Quickshell.Io
import "FocusdModel.js" as Model
import "shared" as FocusdShared

Item {
  id: root

  property var shell: null
  property var manifest: null

  property string status: "stopped"
  property string session: "work"
  property string sessionLabel: "Work"
  property string nextSessionLabel: "Short Break"
  property string remainingText: "25:00"
  property real progress: 0
  property string tooltipText: ""

  property bool installed: false

  // Session-end chime. prevSession/prevStatus are the session key and
  // status from the previous status poll ("" until the first poll lands, so
  // the first thing the timer reports never chimes; both are cleared again
  // whenever the timer reports stopped, so a stop followed by a manual
  // start never chimes). soundsEnabled and soundFile come from
  // ~/.config/omarchy/focusd.json via configure() below.
  property string prevSession: ""
  property string prevStatus: ""
  property bool soundsEnabled: true
  property string soundFile: Model.DEFAULT_SOUND
  // Breather link. breakPattern is the pattern the Breather opens with
  // when a break starts ("box" by default); an empty pattern turns the
  // link off. breatherLaunchedFor is the session key the Breather already
  // launched for, so a break launches once; it clears when a work session
  // starts. Set in configure() from ~/.config/omarchy/focusd.json.
  // suppressBreatherUntilPaused holds the Breather off after a run ends:
  // the run-end reset is async, so the break still reads running for a
  // poll or two, and without this the Breather would launch for a break
  // that is about to sit paused. It clears when a poll sees the break
  // paused, so a later resume launches as intended.
  property string breakPattern: "box"
  property string breatherLaunchedFor: ""
  property bool suppressBreatherUntilPaused: false

  // Variable timer lengths (Phase 3). Durations live in focusd's
  // config.toml, under the active preset; the sliders edit that preset.
  // Loaded from the TOML on the 10s poll, written back on slider release.
  // A change takes effect from the next session of that type.
  property string activePreset: "pomodoro"
  property int workMinutes: 25
  property int shortBreakMinutes: 5
  property int longBreakMinutes: 15
  property string durationsRaw: ""
  property bool durationsApplied: false
  // A slider release is waiting on a fresh re-read of the TOML. The
  // cached text can be up to 10s old, and a change made in the focusd
  // TUI inside that window would be overwritten if the write used it.
  // Only the released slider's key is written (pendingWriteKind/Value) —
  // the other sliders may hold stale values, and passing those in would
  // write them back over a TUI change to a different key.
  property bool pendingWrite: false
  property string pendingWriteKind: ""
  property int pendingWriteValue: 0

  // Rounds before stop (Phase 4). `rounds` is how many work sessions run
  // before the timer stops (0 = off, unlimited); `roundsCompleted` is how
  // many work sessions this run has finished. The count is in-memory: it
  // resets when a run completes, when the daemon restarts, when the shell
  // restarts, and when the day changes (sessions_today drops). Set in
  // configure() from ~/.config/omarchy/focusd.json. prevSessionsToday is
  // the last poll's sessions_today (-1 = unknown, e.g. after a daemon
  // restart), used to spot the day change.
  property int rounds: 0
  property int roundsCompleted: 0
  property int prevSessionsToday: -1

  // Block tagging (Phase 5). `tags` is the category list from
  // focusd.json; `currentTag` is the tag for the current/next work block,
  // picked in the panel. Completed work blocks are recorded in
  // ~/.config/omarchy/focusd-sessions.json (one { date, tag, minutes }
  // entry per block) — the source Phase 6 exports to the Obsidian log.
  // `lastWorkSession` is the most recent completed block, for the panel's
  // Last row (tap its tag to fix it afterwards). The log is re-read on
  // the 10s poll, so a hand edit shows up; only this plugin writes it.
  property var tags: Model.DEFAULT_TAGS.slice()
  property string currentTag: "Work"
  property var lastWorkSession: null
  property var sessionLog: []
  readonly property string sessionsPath: Quickshell.env("HOME") + "/.config/omarchy/focusd-sessions.json"
  property string sessionsRaw: ""
  property bool sessionsApplied: false
  // The log has its own 1 MiB read cap (matching write-config's), not the
  // 64 KiB config cap: compact entries are ~50 bytes, so 1 MiB is years
  // of blocks. sessionsLoadedOk is true only when the last read
  // succeeded — a failed read (overflow, timeout) must never be treated
  // as an empty log, or the next block-end write would replace the whole
  // history with one entry. Writes are skipped while it is false.
  readonly property int sessionsMaxBytes: 1048576
  property bool sessionsLoadedOk: false
  // The remaining time at the previous status poll, in seconds — the
  // work block's length is measured from it when the block ends.
  property int prevRemainingSecs: 0
  // The configured work length when the current work block started, in
  // minutes. elapsedMinutes uses this, not the current slider value, so
  // changing the work length mid-block does not mis-measure the block.
  // 0 means "unknown" (no work session seen yet) — then the current
  // work length is used instead.
  property int blockStartWorkMinutes: 0

  property int sessionsToday: 0
  property string focusedToday: "0s"
  property string dailyGoal: ""
  property int currentStreak: 0
  property int workSessionsBeforeLongBreak: 4
  property int completedSessions: 0
  property bool hasSessionData: false

  property string focusdVersion: ""
  property bool versionChecked: false
  readonly property string requiredVersionForAddMinutes: "0.2.1"
  readonly property bool hasAddMinutesFeature: versionChecked && compareVersions(focusdVersion, requiredVersionForAddMinutes) >= 0

  readonly property bool stopped: status === "stopped"
  readonly property bool running: status === "running"
  readonly property bool paused: status === "paused"
  readonly property bool active: !stopped && (running || progress > 0)

  // Icons shown in the bar, keyed like waybar's format-icons. Customizable
  // through the plugin settings (see README).
  property var icons: defaultIcons()
  function defaultIcons() {
    return {
      "work": "",
      "work-paused": "󰏤",
      "short-break": "",
      "short-break-paused": "󰏤",
      "long-break": "󰒲",
      "long-break-paused": "󰏤"
    };
  }

  // The bar label, e.g. "󰏤 24:45".
  readonly property string barText: root.icon + (root.remainingText !== "" ? " " + root.remainingText : "")
  readonly property string barTooltip: root.tooltipText !== "" ? root.tooltipText : root.sessionLabel + " · " + root.remainingText

  function configure() {
    var merged = defaultIcons();
    var custom = (root.fileConfig && root.fileConfig.icons) || {};
    for (var key in custom)
      if (custom[key] !== undefined)
        merged[key] = String(custom[key]);
    icons = merged;
    // Sounds are on unless the config turns them off; a bare filename is
    // resolved into the freedesktop theme by the model, a path is used as-is.
    root.soundsEnabled = !root.fileConfig || root.fileConfig.sounds !== false;
    var sf = root.fileConfig && root.fileConfig.soundFile;
    root.soundFile = sf ? String(sf) : Model.DEFAULT_SOUND;
    // Breather link: a pattern name launches the Breather on breaks; an
    // empty pattern turns the link off. "box" is the default.
    var bp = root.fileConfig && root.fileConfig.breakPattern;
    root.breakPattern = (bp === undefined || bp === null) ? "box" : String(bp);
    // Rounds before stop: how many work sessions run before the timer
    // stops. 0 (the default) means off — run without a limit.
    var r = root.fileConfig && root.fileConfig.rounds;
    var clamped = (r === undefined || r === null) ? 0 : Model.clampRounds(r);
    root.rounds = clamped === null ? 0 : clamped;
    // Block tags (Phase 5): the category list for work blocks, from
    // focusd.json. Anything else (or nothing) is the default five. If the
    // current tag is not in the list anymore, fall back to the first.
    var tg = root.fileConfig && root.fileConfig.tags;
    root.tags = Model.parseTags(tg);
    if (root.tags.indexOf(root.currentTag) === -1)
      root.currentTag = root.tags[0];
  }
  property var fileConfig: ({})
  function parseFileConfig(raw) {
    try {
      var parsed = JSON.parse(String(raw || ""));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : ({});
    } catch (e) {
      return ({});
    }
  }
  property int maxConfigBytes: 65536
  property int configTimeoutMs: 5000
  readonly property string readScriptPath: Qt.resolvedUrl("read-config").toString().replace(/^file:\/\//, "")
  readonly property string writeScriptPath: Qt.resolvedUrl("write-config").toString().replace(/^file:\/\//, "")
  readonly property string focusdConfigPath: Quickshell.env("HOME") + "/.config/focusd/config.toml"
  readonly property string focusdJsonPath: Quickshell.env("HOME") + "/.config/omarchy/focusd.json"
  // A Rounds slider release waiting on a fresh focusd.json re-read.
  // Only the rounds key is written, on top of that fresh text — the
  // cached text can be up to 10s old, so writing from it could
  // overwrite a hand edit made in that window.
  property bool pendingRoundsWrite: false
  property int pendingRoundsValue: 0
  property string configRaw: ""
  property bool configApplied: false

  function killProc(proc) {
    try {
      proc.signal(9);
    } catch (e) {
    }
    proc.running = false;
  }

  function loadConfig() {
    if (configProc.running)
      return;
    configProc.collected = "";
    configProc.collectedBytes = 0;
    configProc.overflowed = false;
    configProc.timedOut = false;
    configProc.command = [root.readScriptPath, root.focusdJsonPath, String(root.maxConfigBytes)];
    configWatchdog.restart();
    configProc.running = true;
  }

  function applyConfig(ok, raw) {
    var next = ok ? String(raw || "") : "";
    if (root.pendingRoundsWrite) {
      // A Rounds slider release is waiting on this fresh read. Only the
      // rounds key is written, on top of the fresh text — a hand edit to
      // another key inside the poll window must not be written back over.
      // If the read failed, write nothing; the next poll snaps the
      // slider back. A write that changes nothing is skipped.
      var value = root.pendingRoundsValue;
      root.pendingRoundsWrite = false;
      if (ok) {
        var updated = Model.setJsonKey(next, "rounds", value);
        if (updated !== next) {
          root.configRaw = updated;
          Quickshell.execDetached(["bash", root.writeScriptPath, "--create", root.focusdJsonPath, updated]);
        }
      }
      return;
    }
    if (next === root.configRaw && root.configApplied)
      return;
    root.configRaw = next;
    root.configApplied = true;
    root.fileConfig = root.parseFileConfig(next);
    root.configure();
  }

  // A Rounds slider release re-reads focusd.json fresh, then writes
  // only the rounds key on top of that fresh text (in applyConfig).
  // The cached text can be up to 10s old, so writing from it could
  // overwrite a hand edit made in that window. The 10s poll re-reads
  // the file and confirms the write; if it failed, the slider snaps back
  // to the file's value.
  function writeRounds(value) {
    var v = Model.clampRounds(value);
    if (v === null)
      return;
    root.rounds = v;
    root.pendingRoundsValue = v;
    root.pendingRoundsWrite = true;
    root.loadConfig();
  }

  Timer {
    id: configWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (configProc.running) {
        configProc.timedOut = true;
        configProc.collected = "";
        configProc.collectedBytes = 0;
        root.killProc(configProc);
      }
    }
  }

  // Durations: read the active preset's lengths from focusd's
  // config.toml (same read-config helper and 10s poll as the plugin
  // config). Only re-parses when the file's text changed, so a slider
  // drag is never fought by the poll, and a change made in the focusd
  // TUI shows up here within a poll. An unparseable file keeps the last
  // good values.
  function loadDurations() {
    if (durationsProc.running)
      return;
    durationsProc.collected = "";
    durationsProc.collectedBytes = 0;
    durationsProc.overflowed = false;
    durationsProc.timedOut = false;
    durationsProc.command = [root.readScriptPath, root.focusdConfigPath, String(root.maxConfigBytes)];
    durationsWatchdog.restart();
    durationsProc.running = true;
  }

  function applyDurations(ok, raw) {
    var next = ok ? String(raw || "") : "";
    if (root.pendingWrite) {
      // A slider release is waiting on this fresh read. Only the released
      // slider's key is written, on top of the fresh text — the other
      // sliders may hold stale values (a change made in the focusd TUI
      // inside the poll window), and passing those in would write them
      // back over the TUI change. If the read failed, write nothing; the
      // next poll snaps the sliders back. A write that changes nothing is
      // skipped.
      var kind = root.pendingWriteKind;
      var value = root.pendingWriteValue;
      root.pendingWrite = false;
      root.pendingWriteKind = "";
      if (ok) {
        var updated = Model.updateDuration(next, kind, value);
        if (updated !== null && updated !== next) {
          root.durationsRaw = updated;
          // Run through bash explicitly: the script's executable bit does
          // not survive a push through the GitHub API, and bash reads it
          // either way.
          Quickshell.execDetached(["bash", root.writeScriptPath, root.focusdConfigPath, updated]);
        }
      }
      return;
    }
    if (next === root.durationsRaw && root.durationsApplied)
      return;
    root.durationsRaw = next;
    root.durationsApplied = true;
    var parsed = Model.parseDurations(next);
    if (!parsed)
      return;
    root.activePreset = parsed.preset;
    root.workMinutes = parsed.work;
    root.shortBreakMinutes = parsed.shortBreak;
    root.longBreakMinutes = parsed.longBreak;
  }

  // A slider release re-reads config.toml fresh, then writes only the
  // released slider's key on top of that fresh text (in applyDurations).
  // The cached text can be up to 10s old, so writing from it could
  // overwrite a change made in the focusd TUI in that window — and the
  // other sliders still hold their (now stale) values, so only the
  // released key is ever passed in. The 10s poll re-reads the file and
  // confirms the write; if it failed, the sliders snap back to the
  // file's values.
  function writeDurations(kind, value) {
    var v = Math.round(Number(value));
    if (kind === "work") root.workMinutes = v;
    else if (kind === "shortBreak") root.shortBreakMinutes = v;
    else if (kind === "longBreak") root.longBreakMinutes = v;
    else return;
    root.pendingWriteKind = kind;
    root.pendingWriteValue = v;
    root.pendingWrite = true;
    root.loadDurations();
  }

  Timer {
    id: durationsWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (durationsProc.running) {
        durationsProc.timedOut = true;
        durationsProc.collected = "";
        durationsProc.collectedBytes = 0;
        root.killProc(durationsProc);
      }
    }
  }

  // Sessions log: read the completed-work-blocks log (same read-config
  // helper and 10s poll as the plugin config). Only re-parses when the
  // file's text changed. A missing file is an empty log — read-config
  // exits 0 with no output for it, so it reads as success and the file
  // is created on the first block (write-config --create). A failed read
  // (overflow, timeout) keeps the last good log and clears
  // sessionsLoadedOk, so no write can clobber the file from a stale view.
  function loadSessions() {
    if (sessionsProc.running)
      return;
    sessionsProc.collected = "";
    sessionsProc.collectedBytes = 0;
    sessionsProc.overflowed = false;
    sessionsProc.timedOut = false;
    sessionsProc.command = [root.readScriptPath, root.sessionsPath, String(root.sessionsMaxBytes)];
    sessionsWatchdog.restart();
    sessionsProc.running = true;
  }

  function applySessions(ok, raw) {
    if (!ok) {
      // The read failed (overflow, timeout, or an I/O error). Keep the
      // last good log exactly as it is — do not treat the failure as an
      // empty log — and mark the log unloaded so no write runs until a
      // read succeeds again.
      root.sessionsLoadedOk = false;
      return;
    }
    root.sessionsLoadedOk = true;
    var next = String(raw || "");
    if (next === root.sessionsRaw && root.sessionsApplied)
      return;
    root.sessionsRaw = next;
    root.sessionsApplied = true;
    var log = Model.parseSessionLog(next);
    root.sessionLog = log;
    root.lastWorkSession = log.length ? log[log.length - 1] : null;
  }

  // Block tagging: pick the tag for the current/next work block.
  function setCurrentTag(tag) {
    if (root.tags.indexOf(tag) !== -1)
      root.currentTag = tag;
  }

  // Fix the last completed block's tag afterwards: cycle it to the next
  // category and rewrite the log. Nothing to fix when no block has
  // completed yet, and nothing is written while the log is unloaded (a
  // failed read) — a retag must never rewrite the file from a stale view.
  function cycleLastTag() {
    if (!root.lastWorkSession || !root.sessionsLoadedOk)
      return;
    var next = Model.nextTag(root.tags, root.lastWorkSession.tag);
    var logText = Model.retagSessionLog(root.sessionsRaw, next);
    if (logText === null)
      return;
    root.sessionsRaw = logText;
    root.sessionLog = Model.parseSessionLog(logText);
    root.lastWorkSession = root.sessionLog.length ? root.sessionLog[root.sessionLog.length - 1] : null;
    Quickshell.execDetached(["bash", root.writeScriptPath, "--create", root.sessionsPath, logText]);
  }

  Timer {
    id: sessionsWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (sessionsProc.running) {
        sessionsProc.timedOut = true;
        sessionsProc.collected = "";
        sessionsProc.collectedBytes = 0;
        root.killProc(sessionsProc);
      }
    }
  }

  Timer {
    id: configPoll
    interval: 10000
    repeat: true
    running: true
    onTriggered: {
      root.loadConfig();
      root.loadDurations();
      root.loadSessions();
    }
  }

  Process {
    id: durationsProc
    property string collected: ""
    property int collectedBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    stdout: SplitParser {
      onRead: function (data) {
        if (durationsProc.overflowed || durationsProc.timedOut)
          return;
        var chunk = String(data + "\n");
        if (durationsProc.collectedBytes + chunk.length > root.maxConfigBytes) {
          durationsProc.overflowed = true;
          durationsProc.collected = "";
          durationsProc.collectedBytes = 0;
          root.killProc(durationsProc);
          return;
        }
        durationsProc.collected += chunk;
        durationsProc.collectedBytes += chunk.length;
      }
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (durationsProc.overflowed || durationsProc.timedOut)
          return;
        durationsProc.collectedBytes += String(data + "\n").length;
        if (durationsProc.collectedBytes > root.maxConfigBytes) {
          durationsProc.overflowed = true;
          durationsProc.collected = "";
          durationsProc.collectedBytes = 0;
          root.killProc(durationsProc);
        }
      }
    }
    onExited: function (exitCode) {
      durationsWatchdog.stop();
      var ok = !durationsProc.overflowed && !durationsProc.timedOut && exitCode === 0;
      var output = String(durationsProc.collected);
      durationsProc.collected = "";
      durationsProc.collectedBytes = 0;
      durationsProc.overflowed = false;
      durationsProc.timedOut = false;
      root.applyDurations(ok, output);
    }
  }

  Process {
    id: sessionsProc
    property string collected: ""
    property int collectedBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    stdout: SplitParser {
      onRead: function (data) {
        if (sessionsProc.overflowed || sessionsProc.timedOut)
          return;
        var chunk = String(data + "\n");
        if (sessionsProc.collectedBytes + chunk.length > root.sessionsMaxBytes) {
          sessionsProc.overflowed = true;
          sessionsProc.collected = "";
          sessionsProc.collectedBytes = 0;
          root.killProc(sessionsProc);
          return;
        }
        sessionsProc.collected += chunk;
        sessionsProc.collectedBytes += chunk.length;
      }
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (sessionsProc.overflowed || sessionsProc.timedOut)
          return;
        sessionsProc.collectedBytes += String(data + "\n").length;
        if (sessionsProc.collectedBytes > root.sessionsMaxBytes) {
          sessionsProc.overflowed = true;
          sessionsProc.collected = "";
          sessionsProc.collectedBytes = 0;
          root.killProc(sessionsProc);
        }
      }
    }
    onExited: function (exitCode) {
      sessionsWatchdog.stop();
      var ok = !sessionsProc.overflowed && !sessionsProc.timedOut && exitCode === 0;
      var output = String(sessionsProc.collected);
      sessionsProc.collected = "";
      sessionsProc.collectedBytes = 0;
      sessionsProc.overflowed = false;
      sessionsProc.timedOut = false;
      root.applySessions(ok, output);
    }
  }

  Process {
    id: configProc
    property string collected: ""
    property int collectedBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    stdout: SplitParser {
      onRead: function (data) {
        if (configProc.overflowed || configProc.timedOut)
          return;
        var chunk = String(data + "\n");
        if (configProc.collectedBytes + chunk.length > root.maxConfigBytes) {
          configProc.overflowed = true;
          configProc.collected = "";
          configProc.collectedBytes = 0;
          root.killProc(configProc);
          return;
        }
        configProc.collected += chunk;
        configProc.collectedBytes += chunk.length;
      }
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (configProc.overflowed || configProc.timedOut)
          return;
        configProc.collectedBytes += String(data + "\n").length;
        if (configProc.collectedBytes > root.maxConfigBytes) {
          configProc.overflowed = true;
          configProc.collected = "";
          configProc.collectedBytes = 0;
          root.killProc(configProc);
        }
      }
    }
    onExited: function (exitCode) {
      configWatchdog.stop();
      var ok = !configProc.overflowed && !configProc.timedOut && exitCode === 0;
      var output = String(configProc.collected);
      configProc.collected = "";
      configProc.collectedBytes = 0;
      configProc.overflowed = false;
      configProc.timedOut = false;
      root.applyConfig(ok, output);
    }
  }

  function iconFor(key) {
    var value = icons[key];
    return value !== undefined && value !== "" ? value : "";
  }

  readonly property string icon: root.iconFor(status === "paused" ? session + "-paused" : session)

  function playOrStop() {
    if (running)
      Quickshell.execDetached(["focusd", "reset"]);
    else
      Quickshell.execDetached(["focusd", "start"]);
  }

  function togglePause() {
    if (stopped)
      return;
    Quickshell.execDetached(["focusd", "toggle"]);
  }

  function skip() {
    if (stopped)
      return;
    Quickshell.execDetached(["focusd", "next"]);
  }

  function stop() {
    if (stopped)
      return;
    Quickshell.execDetached(["focusd", "reset"]);
  }

  function addMinutes(minutes) {
    if (stopped || !hasAddMinutesFeature)
      return;
    Quickshell.execDetached(["focusd", "--add-minutes", String(minutes)]);
  }

  function compareVersions(v1, v2) {
    if (!v1 || !v2)
      return 0;
    var parts1 = String(v1).replace(/^v/, "").split(".");
    var parts2 = String(v2).replace(/^v/, "").split(".");
    for (var i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      var p1 = Number(parts1[i]) || 0;
      var p2 = Number(parts2[i]) || 0;
      if (p1 > p2)
        return 1;
      if (p1 < p2)
        return -1;
    }
    return 0;
  }

  function poll() {
    stateProc.running = false;
    stateProc.collected = "";
    stateProc.command = ["focusd", "status"];
    stateProc.running = true;
  }

  function parseVersion(output) {
    var match = String(output || "").match(/(?:focusd\s+)?v?(\d+\.\d+\.\d+)/i);
    return match && match[1] ? match[1] : "";
  }

  function checkVersion() {
    if (!root.versionChecked && !versionProc.running) {
      versionProc.running = false;
      versionProc.collected = "";
      versionProc.command = ["focusd", "--version"];
      versionProc.running = true;
    }
  }

  function parseState(raw) {
    var text = String(raw || "").trim();
    if (!text) {
      status = "stopped";
      // No timer to chime from: clear the previous session so the next
      // session the daemon reports (it restarts as Work) reads as a first
      // poll, not as a session ending. The run is over too.
      root.prevSession = "";
      root.prevStatus = "";
      root.prevRemainingSecs = 0;
      root.roundsCompleted = 0;
      root.prevSessionsToday = -1;
      return;
    }
    var state = {};
    try {
      state = JSON.parse(text);
    } catch (error) {
      console.warn("Focusd: ignoring invalid state:", error);
      status = "stopped";
      root.prevSession = "";
      root.prevStatus = "";
      root.prevRemainingSecs = 0;
      root.roundsCompleted = 0;
      root.prevSessionsToday = -1;
      return;
    }
    // A new day starts a new run: sessions_today drops (to 0) when the
    // date changes, so a run stopped yesterday does not carry its count
    // into today. (A manual focusd stop leaves the timer paused, not
    // stopped, so it does not reset the count — the day boundary is the
    // signal that the run is over.)
    var sessionsTodayNow = Number(state.sessions_today) || 0;
    if (root.prevSessionsToday >= 0 && sessionsTodayNow < root.prevSessionsToday)
      root.roundsCompleted = 0;
    root.prevSessionsToday = sessionsTodayNow;
    var classes = state.class || [];
    var alt = String(state.alt || "work");
    var newStatus = classes.indexOf("paused") !== -1 ? "paused" : "running";
    var sessionKey = alt.replace(/-paused$/, "");
    // Remember the configured work length when a work block starts. The
    // block's minutes are measured from this, not the current slider
    // value, so changing the work length mid-block does not mis-measure
    // it. (A block already running at startup is recorded at the first
    // poll, which is the best guess available.)
    if (sessionKey === "work" && root.prevSession !== "work")
      root.blockStartWorkMinutes = root.workMinutes;
    // A session ending is a session change out of a session that was
    // running: the previous session ran out (or was skipped) and the next
    // one began. The chime fires once, on the poll that sees the change.
    // Pause and resume never change the session, so they stay silent; a
    // stop leaves the previous status paused, so a manual start afterwards
    // never chimes either.
    if (Model.shouldChime(root.prevSession, root.prevStatus, sessionKey, root.soundsEnabled))
      Quickshell.execDetached(Model.chimeCommand(Model.resolveSoundFile(root.soundFile)));
    // Rounds: a work session ending into a break completes a round. When
    // the run reaches the configured number of rounds, stop the timer
    // (reset the break to paused) and start a fresh run. The Breather is
    // not launched for the break that ends the run — it would count down
    // while the break sits paused; resuming the break launches it instead.
    // (The chime above still fires: the work session did end.)
    var runEnded = false;
    if (Model.workSessionEnded(root.prevSession, root.prevStatus, sessionKey)) {
      root.roundsCompleted += 1;
      // Block tagging: record the finished work block — its tag and the
      // minutes actually spent — in the session log, and show it as the
      // Last block in the panel. A skipped block is logged with the
      // elapsed minutes, not the full length. The block's length is
      // measured from the work length when it started, not the current
      // slider value. Nothing is written while the log is unloaded (a
      // failed read) — the block is dropped rather than risking the log.
      // (The write goes through write-config --create, which creates the
      // log file on the first block.)
      var blockLength = root.blockStartWorkMinutes > 0 ? root.blockStartWorkMinutes : root.workMinutes;
      var blockMinutes = Model.elapsedMinutes(blockLength, root.prevRemainingSecs);
      var entry = { date: Qt.formatDate(new Date(), "yyyy-MM-dd"), tag: root.currentTag, minutes: blockMinutes };
      if (root.sessionsLoadedOk) {
        var logText = Model.appendSessionLog(root.sessionsRaw, entry);
        root.sessionsRaw = logText;
        root.sessionLog = Model.parseSessionLog(logText);
        root.lastWorkSession = entry;
        Quickshell.execDetached(["bash", root.writeScriptPath, "--create", root.sessionsPath, logText]);
      }
      if (Model.shouldStopAfterRound(root.rounds, root.roundsCompleted)) {
        runEnded = true;
        root.roundsCompleted = 0;
        // Hold the Breather off until a poll sees the break paused: the
        // reset below is async, so the break still reads running for a
        // poll or two, and the Breather would launch for a break that is
        // about to sit paused.
        root.suppressBreatherUntilPaused = true;
        Quickshell.execDetached(["focusd", "reset"]);
      }
    }
    // The run-end reset is async. Until a poll sees the break paused,
    // keep the Breather suppressed; once it reads paused, clear the flag
    // so a later resume launches as intended.
    if (Model.isBreakSession(sessionKey) && newStatus === "paused")
      root.suppressBreatherUntilPaused = false;
    // Breather link: launch once per break, on the first poll where the
    // break is running. A break that starts paused does not launch until
    // the user resumes it; pause/resume mid-break does not relaunch. The
    // launch key clears when a work session starts, so the next break of
    // the same kind launches again. (The chime above stays on the
    // session-ended edge; the Breather has its own rule.)
    if (sessionKey === "work") {
      root.breatherLaunchedFor = "";
    } else if (!runEnded && !root.suppressBreatherUntilPaused) {
      var breakMinutes = Model.parseMinutes(state.text);
      if (Model.shouldLaunchBreather(sessionKey, newStatus, root.breatherLaunchedFor, root.breakPattern, breakMinutes)) {
        root.breatherLaunchedFor = sessionKey;
        Quickshell.execDetached(Model.breatherCommand(root.breakPattern, breakMinutes));
      }
    }
    root.prevSession = sessionKey;
    root.prevStatus = newStatus;
    // The remaining time on this poll is what the next poll measures a
    // session's length against, if that session ends there.
    root.prevRemainingSecs = Model.parseSeconds(state.text);
    root.status = newStatus;
    root.session = sessionKey;
    root.sessionLabel = sessionLabelFor(sessionKey);
    root.nextSessionLabel = String(state.next_session || nextSessionLabelFor(sessionKey));
    root.remainingText = String(state.text || "");
    root.progress = Math.max(0, Math.min(1, (Number(state.percentage) || 0) / 100));
    root.tooltipText = String(state.tooltip || "");
    root.sessionsToday = sessionsTodayNow;
    root.focusedToday = String(state.focused_today || "");
    root.dailyGoal = String(state.daily_goal || "");
    root.currentStreak = Number(state.current_streak) || 0;
    if (state.work_sessions_before_long_break !== undefined)
      root.workSessionsBeforeLongBreak = Math.max(1, Math.min(20, Number(state.work_sessions_before_long_break) || 4));
    if (state.completed_sessions !== undefined)
      root.completedSessions = Number(state.completed_sessions) || 0;
    root.hasSessionData = state.work_sessions_before_long_break !== undefined && state.completed_sessions !== undefined;
  }

  function sessionLabelFor(key) {
    if (key === "short-break")
      return "Short Break";
    if (key === "long-break")
      return "Long Break";
    return "Work";
  }

  function nextSessionLabelFor(key) {
    if (key === "work")
      return "Short Break";
    if (key === "short-break")
      return "Work";
    return "Work";
  }

  Timer {
    interval: 1000
    repeat: true
    running: true
    onTriggered: root.poll()
  }

  Process {
    id: stateProc
    property string collected: ""
    stdout: SplitParser {
      onRead: function (data) {
        stateProc.collected += data + "\n";
      }
    }
    onExited: function (exitCode) {
      root.installed = exitCode === 0;
      if (exitCode === 0 && String(stateProc.collected).trim() !== "") {
        root.parseState(stateProc.collected);
        root.checkVersion();
      } else {
        root.status = "stopped";
      }
    }
  }

  Process {
    id: versionProc
    property string collected: ""
    stdout: SplitParser {
      onRead: function (data) {
        versionProc.collected += data;
      }
    }
    onExited: function (exitCode) {
      if (exitCode === 0) {
        var parsed = root.parseVersion(versionProc.collected);
        if (parsed !== "") {
          root.focusdVersion = parsed;
          root.versionChecked = true;
        }
      }
    }
  }

  Component.onCompleted: {
    FocusdShared.ServiceBridge.service = root;
    root.poll();
    root.checkVersion();
    root.loadConfig();
    root.loadDurations();
    root.loadSessions();
  }
  Component.onDestruction: {
    if (FocusdShared.ServiceBridge.service === root)
      FocusdShared.ServiceBridge.service = null;
  }
}
