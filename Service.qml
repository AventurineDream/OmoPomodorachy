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
  // link off. breatherEnabled is the link's master switch and
  // breatherAutoLaunch the auto-launch toggle — both on by default, so a
  // config written before they existed keeps the old behaviour. Either
  // one off means no launch; turning one off keeps the pattern, so
  // flipping it back on resumes launching. breatherExpanded is whether
  // the panel's Breather section is expanded. All three are set in
  // configure() from ~/.config/omarchy/focusd.json, and the panel
  // persists them there.
  property string breakPattern: "box"
  property bool breatherEnabled: true
  property bool breatherAutoLaunch: true
  property bool breatherExpanded: true
  // Breather pattern options for the panel's pattern Dropdown: the
  // built-ins plus the customs from patterns.json, as { value, label }
  // pairs. Loaded with the same read-config helper as focusd.json and
  // re-read on the 10s poll, so editing patterns.json updates the list.
  readonly property string patternsPath: Quickshell.env("HOME") + "/.config/omarchy/zen/patterns.json"
  property string patternsRaw: ""
  readonly property var patternOptions: Model.breatherPatternOptions(root.patternsRaw)
  // breatherLaunchedFor is the session key the Breather already launched
  // for, so a break launches once; it clears when a work session starts.
  // suppressBreatherUntilPaused holds the Breather off after a run ends:
  // the run-end reset is async, so the break still reads running for a
  // poll or two, and without this the Breather would launch for a break
  // that is about to sit paused. It clears when a poll sees the break
  // paused, so a later resume launches as intended.
  property string breatherLaunchedFor: ""
  property bool suppressBreatherUntilPaused: false

  // Variable timer lengths (Phase 3). Durations live in focusd's
  // config.toml, under the active preset; the sliders edit that preset.
  // Loaded from the TOML on the 10s poll, written back on slider release.
  // A change takes effect from the next session of that type.
  property string activePreset: "pomodoro"
  property var presets: []
  property int workMinutes: 25
  property int shortBreakMinutes: 5
  property int longBreakMinutes: 15
  property string durationsRaw: ""
  property bool durationsApplied: false
  // Whether the Durations section in the panel is expanded. Persisted
  // in focusd.json so the choice sticks across shell restarts.
  property bool durationsExpanded: true
  // Whether the "Tag this block" section in the panel is expanded.
  // Persisted in focusd.json, same as durationsExpanded.
  property bool tagsExpanded: true
  // A slider release is waiting on a fresh re-read of the TOML. The
  // cached text can be up to 10s old, and a change made in the focusd
  // TUI inside that window would be overwritten if the write used it.
  // Only the released slider's key is written (pendingWriteKind/Value) —
  // the other sliders may hold stale values, and passing those in would
  // write them back over a TUI change to a different key.
  property bool pendingWrite: false
  // Bumped on every queued write to focusd's config.toml. A durations read
  // that started before a bump may predate that write, so it is discarded.
  property int focusdWriteSeq: 0
  property string pendingWriteKind: ""
  property int pendingWriteValue: 0
  // A preset switch or Save As is waiting on a fresh re-read of the
  // TOML (same reason as the duration write: the cached text can be up
  // to 10s old). pendingPresetOp is "setPreset" or "savePreset";
  // pendingPresetArg is the preset name.
  property string pendingPresetOp: ""
  property string pendingPresetArg: ""
  // The preset a pending pick replaced; put back if its fresh read fails.
  property string pendingPresetPrev: ""

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
  // Tag schedule: an ordered queue of tags for upcoming work blocks,
  // from focusd.json (`tagSchedule`). When a work block ends, the next
  // tag is taken from the front of the queue and becomes the current tag
  // for the block after it; an empty queue leaves the current tag alone.
  // Named schedule presets (`tagSchedulePresets`: name -> tag array)
  // save a queue for reuse.
  property var tagSchedule: []
  property var tagSchedulePresets: ({})
  // Set when a tag or schedule write was refused (the config read
  // failed, so writing from the cached view could wipe other keys).
  // The panel shows a hint; it clears on the next successful write.
  property bool tagWriteRefused: false
  readonly property string sessionsPath: Quickshell.env("HOME") + "/.config/omarchy/focusd-sessions.json"
  property string sessionsRaw: ""
  property bool sessionsApplied: false
  // The log has its own 1 MiB read cap (matching write-config's), not the
  // 64 KiB config cap: compact entries are ~50 bytes, so 1 MiB is years
  // of blocks. A failed read (overflow, timeout) must never be treated as
  // an empty log. sessionsLoadedOk is true only when the last read
  // succeeded; it gates the Focus Log export, which is regenerated from
  // sessionsRaw. The sessions log itself is written only from a fresh read
  // (see queueSessionEdit).
  readonly property int sessionsMaxBytes: 1048576
  property bool sessionsLoadedOk: false
  // Edits waiting for a fresh read of the sessions log (queueSessionEdit).
  property var sessionsEdits: []
  // Obsidian sync (Phase 6). The vault Focus Log is a generated table
  // of every completed work block, regenerated whole from the sessions
  // log on every write (so a retag updates the vault row too). The sync
  // is OFF by default — focusLogPath is empty until Aven okays direct
  // vault writes; set it in focusd.json to turn the sync on. An existing
  // file is only replaced when it starts with the generated header.
  property string focusLogPath: ""
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
    // Breather toggles: the link's master switch and the auto-launch
    // toggle. Both on unless the config turns them off, so a config
    // written before they existed keeps launching on breaks.
    root.breatherEnabled = Model.parseOnByDefault(root.fileConfig && root.fileConfig.breatherEnabled);
    root.breatherAutoLaunch = Model.parseOnByDefault(root.fileConfig && root.fileConfig.breatherAutoLaunch);
    // Breather section collapsed or expanded. Defaults to expanded.
    root.breatherExpanded = Model.parseOnByDefault(root.fileConfig && root.fileConfig.breatherExpanded);
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
    // Tag schedule: the queue of tags for upcoming blocks, and the named
    // schedule presets. A missing or malformed value is an empty queue /
    // no presets — the schedule is only ever written by this plugin.
    var ts = root.fileConfig && root.fileConfig.tagSchedule;
    root.tagSchedule = Array.isArray(ts) ? ts.filter(function (t) { return root.tags.indexOf(String(t)) !== -1; }) : [];
    var tsp = root.fileConfig && root.fileConfig.tagSchedulePresets;
    root.tagSchedulePresets = (tsp && typeof tsp === "object" && !Array.isArray(tsp)) ? tsp : ({});
    // Durations section collapsed or expanded. Defaults to expanded.
    var de = root.fileConfig && root.fileConfig.durationsExpanded;
    root.durationsExpanded = (de === undefined || de === null) ? true : !!de;
    // "Tag this block" section collapsed or expanded. Defaults to expanded.
    var te = root.fileConfig && root.fileConfig.tagsExpanded;
    root.tagsExpanded = (te === undefined || te === null) ? true : !!te;
    // Obsidian sync (Phase 6): where the generated Focus Log goes. Off
    // by default — an empty focusLogPath until Aven okays direct vault
    // writes; a path in focusd.json turns it on (must be absolute).
    var fl = root.fileConfig && root.fileConfig.focusLogPath;
    if (fl === undefined || fl === null)
      root.focusLogPath = "";
    else
      root.focusLogPath = String(fl);
  }

  // Every write-config call goes through one Process (configWriteProc),
  // one write at a time, in queue order. The content is never an argv
  // element: Linux refuses a single argument of 128 KiB or more (E2BIG),
  // and the sessions log and Focus Log grow to the 1 MiB write-config
  // accepts. The content goes to stdin, framed by Model.writeConfigInput,
  // and is written from onStarted (a write before the process starts is
  // lost). Stdin is not closed: write-config stops at the byte count, and
  // on Quickshell 0.3.2 a large write does not reliably reach EOF once
  // stdinEnabled is cleared. A write that runs past writeTimeoutMs is
  // killed, so one stuck write cannot hold the queue. A failed write is
  // logged (console.warn) unless the job brings its own onExit.
  // writePending(path) is true while a write to that path is queued or
  // running. The loaders wait for it, so a poll never reads back the
  // file's older text and then writes from it.
  property int writeTimeoutMs: 15000
  property var writeQueue: []
  property var activeWrite: null
  function queueWrite(path, command, content, onExit) {
    root.queueFramedWrite(path, command, Model.writeConfigInput(content), onExit);
  }
  // queueWrite for input already framed: Model.writeConfigInput for one
  // frame, Model.writeConfigGuardedInput for the sessions log's guarded pair.
  function queueFramedWrite(path, command, input, onExit) {
    if (path === root.focusdConfigPath)
      root.focusdWriteSeq++;
    root.writeQueue.push({ path: path, command: command, input: input, onExit: onExit || null, timedOut: false });
    root.drainWrites();
  }
  function writePending(path) {
    if (root.activeWrite && root.activeWrite.path === path)
      return true;
    for (var i = 0; i < root.writeQueue.length; i++) {
      if (root.writeQueue[i].path === path)
        return true;
    }
    return false;
  }
  function drainWrites() {
    if (configWriteProc.running || root.writeQueue.length === 0)
      return;
    root.activeWrite = root.writeQueue.shift();
    configWriteProc.command = root.activeWrite.command;
    configWriteProc.running = true;
    writeWatchdog.restart();
  }

  // Ask for the Focus Log export. Only applySessionBatch calls this, after
  // an edit was applied to a fresh read of the sessions log. The export runs
  // once focusd.json has been read again (loadConfig, applyConfigRead), so it
  // goes to the focusLogPath the file holds at that moment: a destination
  // removed or changed by hand since the last 10s poll gets nothing.
  function writeFocusLog() {
    root.focusLogExportPending = true;
    root.runConfigEdits();
  }

  // Rewrite the Focus Log export from sessionsRaw, the sessions log as the
  // last applied edit or read left it. Only applyConfigRead calls this, for
  // an export requested before its read started. The whole export is
  // regenerated each time (never appended), so a retag updates the row.
  // Nothing is written while the log is unloaded or the sync is off, and
  // an existing file is only replaced when it starts with the generated
  // header, so a hand-written file at that path is left alone. The
  // format follows the path's extension: .csv writes CSV, anything else
  // writes the Markdown table. The path may point anywhere, not only
  // the vault. The write is queued (queueWrite); its exit code tells a
  // guard skip (FOCUS_LOG_GUARD_SKIP_EXIT, 2) from a failed write.
  function exportFocusLog() {
    if (!root.focusLogPath || !root.sessionsLoadedOk)
      return;
    var text = Model.focusLogFormat(root.focusLogPath) === "csv"
      ? Model.focusLogCsvText(root.sessionsRaw)
      : Model.focusLogText(root.sessionsRaw);
    var path = root.focusLogPath;
    var cmd = Model.focusLogCommand(root.writeScriptPath, path);
    if (!cmd)
      return;
    root.queueWrite(path, cmd, text, function (ok, exitCode, timedOut) {
      if (ok)
        return;
      if (!timedOut && exitCode === Model.FOCUS_LOG_GUARD_SKIP_EXIT) {
        console.warn(Model.focusLogSkipMessage(path));
        return;
      }
      console.warn("Focusd: Focus Log write failed for " + path + " (" + (timedOut ? "timed out" : "exit " + exitCode) + ")");
    });
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
  property string configRaw: ""
  property bool configApplied: false
  // True only when the last focusd.json read succeeded and the text
  // parsed (or was empty — no file yet, nothing to lose). writeRounds
  // refuses to write while this is false: a failed read or an invalid
  // file parses to {}, and writing from that would wipe the other keys.
  property bool configOk: false
  // focusd.json key writes waiting for a fresh read of the file
  // (writeFocusdJson), and whether a Focus Log export waits for one
  // (writeFocusLog).
  property var configEdits: []
  property bool focusLogExportPending: false

  function killProc(proc) {
    try {
      proc.signal(9);
    } catch (e) {
    }
    proc.running = false;
  }

  // Reads focusd.json. Every read takes the key writes queued before it
  // starts (configEdits) and any pending Focus Log export request as its
  // batch, so both act on what the file holds now, not on the last poll
  // (see applyConfigRead). It waits out a read or a focusd.json write already
  // running; their exits start it again while work is queued.
  function loadConfig() {
    if (configProc.running || root.writePending(root.focusdJsonPath))
      return;
    configProc.batch = root.configEdits;
    root.configEdits = [];
    configProc.exportAfter = root.focusLogExportPending;
    root.focusLogExportPending = false;
    configProc.stderrBytes = 0;
    configProc.overflowed = false;
    configProc.timedOut = false;
    configProc.command = ["bash", root.readScriptPath, root.focusdJsonPath, String(root.maxConfigBytes)];
    configWatchdog.restart();
    configProc.running = true;
  }

  // Starts a fresh focusd.json read when key writes or an export wait on one.
  function runConfigEdits() {
    if (root.configEdits.length > 0 || root.focusLogExportPending)
      root.loadConfig();
  }

  // Handles one focusd.json read with the batch it took (loadConfig). The
  // batch's key writes are applied to the text just read and written back
  // guarded (write-config --expect) against that text, so a key removed or
  // changed by hand since the last poll is never written back from memory,
  // and a hand edit landing after the read makes the write conflict and retry
  // from a fresh read. A failed read, or a file that is not a JSON object,
  // drops the writes with a warning. A waiting Focus Log export runs after the
  // config is applied, so it goes to the focusLogPath the file holds now (none
  // when the read failed).
  function applyConfigRead(ok, raw, batch, exportAfter) {
    var text = ok ? String(raw || "") : "";
    var written = text;
    if (batch.length > 0) {
      var result = ok ? Model.applyConfigEdits(text, batch) : { skip: "could not read the file" };
      if (result.skip) {
        for (var i = 0; i < batch.length; i++)
          console.warn(Model.configEditSkipMessage(root.focusdJsonPath, batch[i], result.skip));
      } else if (result.text !== text) {
        written = result.text;
        root.queueConfigWrite(text, written, batch);
      }
    }
    // Writes queued while this read ran are not on disk yet: show them on
    // top of it so the panel does not snap back until their own read.
    var shown = Model.applyConfigEdits(written, root.configEdits);
    root.applyConfig(ok, shown.skip ? written : shown.text);
    if (exportAfter)
      root.exportFocusLog();
    root.runConfigEdits();
  }

  // Writes focusd.json guarded against base, the text the edits were applied
  // to. On a conflict (FILE_CHANGED_EXIT) nothing is written and the edits go
  // back to the front of the queue for a fresh read, up to EDIT_MAX_CONFLICTS.
  function queueConfigWrite(base, text, edits) {
    var path = root.focusdJsonPath;
    root.queueFramedWrite(path, ["bash", root.writeScriptPath, "--create", "--expect", path], Model.writeConfigGuardedInput(base, text), function (ok, exitCode, timedOut) {
      if (!ok && !timedOut && exitCode === Model.FILE_CHANGED_EXIT) {
        var r = Model.retryConflictedEdits(edits);
        for (var i = 0; i < r.dropped.length; i++)
          console.warn(Model.configEditSkipMessage(path, r.dropped[i], "the file kept changing, gave up after " + Model.EDIT_MAX_CONFLICTS + " conflicts"));
        root.configEdits = r.retry.concat(root.configEdits);
      } else if (!ok) {
        console.warn("Focusd: focusd.json write failed for " + path + " (" + (timedOut ? "timed out" : "exit " + exitCode) + ")");
      }
      root.runConfigEdits();
    });
  }

  function applyConfig(ok, raw) {
    var next = ok ? String(raw || "") : "";
    if (next === root.configRaw && root.configApplied)
      return;
    root.configRaw = next;
    root.configApplied = true;
    root.fileConfig = root.parseFileConfig(next);
    // The text is safe to write back from when it is empty (no file
    // yet, nothing to lose) or a valid JSON object. An invalid file
    // parses to {}, and writing from that would wipe the other keys —
    // so writeRounds refuses to write while this is false.
    root.configOk = ok && Model.configTextOk(next);
    root.configure();
  }

  // Breather patterns: read ~/.config/omarchy/zen/patterns.json with
  // the same read-config helper as focusd.json, on the same 10s poll.
  // A missing file is not an error (read-config exits 0 with no
  // output) — the options are just the built-ins then. A failed read
  // keeps the last good text, so a transient failure never blanks the
  // picker. The raw text feeds patternOptions; the model parses it.
  function loadPatterns() {
    if (patternsProc.running)
      return;
    patternsProc.collected = "";
    patternsProc.collectedBytes = 0;
    patternsProc.overflowed = false;
    patternsProc.timedOut = false;
    patternsProc.command = ["bash", root.readScriptPath, root.patternsPath, String(root.maxConfigBytes)];
    patternsWatchdog.restart();
    patternsProc.running = true;
  }

  function applyPatterns(ok, raw) {
    if (!ok)
      return;
    root.patternsRaw = String(raw || "");
  }

  // Write one key of focusd.json. The key is queued (configEdits) and set
  // on a fresh read of the file, never on this in-memory copy, so a key the
  // user removed or changed by hand since the last poll — focusLogPath, the
  // export destination, above all — is never written back (applyConfigRead).
  // Refused while the last read failed or the file is invalid (configOk
  // false); the fresh read checks the file again before writing. The cached
  // config takes the new value at once so a second write compares against
  // it. Returns false when the write was refused or nothing changed.
  function writeFocusdJson(key, value) {
    if (!root.configOk)
      return false;
    var cfg = root.fileConfig || {};
    if (JSON.stringify(cfg[key]) === JSON.stringify(value))
      return false;
    cfg[key] = value;
    root.fileConfig = cfg;
    root.configEdits.push({ key: key, value: value });
    root.runConfigEdits();
    return true;
  }

  // A Rounds slider release writes only the rounds key to focusd.json.
  // A hand edit can race it; writeFocusdJson's fresh read and guarded
  // write keep that edit.
  function writeRounds(value) {
    var v = Model.clampRounds(value);
    if (v === null)
      return;
    if (!root.writeFocusdJson("rounds", v))
      return;
    root.rounds = v;
  }

  // Whether the Durations section is expanded. Persisted so the choice
  // sticks across shell restarts.
  function setDurationsExpanded(expanded) {
    root.durationsExpanded = !!expanded;
    root.writeFocusdJson("durationsExpanded", root.durationsExpanded);
  }

  // Whether the "Tag this block" section is expanded. Persisted so
  // the choice sticks across shell restarts.
  function setTagsExpanded(expanded) {
    root.tagsExpanded = !!expanded;
    root.writeFocusdJson("tagsExpanded", root.tagsExpanded);
  }

  // Whether the Breather link is on (the master switch: off means no
  // Breather launch on breaks, and the pattern is kept so flipping it
  // back on resumes launching). Persisted in focusd.json.
  function setBreatherEnabled(enabled) {
    root.breatherEnabled = !!enabled;
    root.writeFocusdJson("breatherEnabled", root.breatherEnabled);
  }

  // Whether the Breather opens automatically when a break starts. Off
  // means no auto-launch — open it yourself with `tb` — and the link
  // stays configured, so flipping it back on resumes launching. Turning
  // it on mid-break launches for the rest of that break (the next poll
  // sees a running break with nothing launched for it yet). Persisted
  // in focusd.json.
  function setBreatherAutoLaunch(enabled) {
    root.breatherAutoLaunch = !!enabled;
    root.writeFocusdJson("breatherAutoLaunch", root.breatherAutoLaunch);
  }

  // Whether the Breather section in the panel is expanded. Persisted
  // so the choice sticks across shell restarts.
  function setBreatherExpanded(expanded) {
    root.breatherExpanded = !!expanded;
    root.writeFocusdJson("breatherExpanded", root.breatherExpanded);
  }

  // The Breather pattern, picked in the panel's Breather section.
  // Persisted in focusd.json as breakPattern ("box" by default); the
  // break-time summon uses it. The picker is disabled while the link
  // is off, so the pattern is never changed by accident — and a stored
  // pattern survives toggling the link off and back on.
  function setBreakPattern(pattern) {
    var p = String(pattern || "");
    root.breakPattern = p;
    root.writeFocusdJson("breakPattern", p);
  }

  // Write a tag/schedule key to focusd.json, recording a refusal so
  // the panel can hint at it. A write that changes nothing is not a
  // refusal — only a failed config read refuses the write.
  function writeTagJson(key, value) {
    if (root.writeFocusdJson(key, value)) {
      root.tagWriteRefused = false;
      return true;
    }
    if (!root.configOk)
      root.tagWriteRefused = true;
    return false;
  }

  // Tag add/remove (from the panel). Adding sets the new tag as the
  // current tag; removing falls back to the first tag when the current
  // one is removed. Both write focusd.json `tags`.
  function addTag(name) {
    var next = Model.addTag(root.tags, name);
    if (next === null)
      return false;
    if (!root.writeTagJson("tags", next))
      return false;
    root.tags = next;
    root.currentTag = String(name).trim();
    return true;
  }

  function removeTag(name) {
    var next = Model.removeTag(root.tags, name);
    if (next === null)
      return false;
    if (!root.writeTagJson("tags", next))
      return false;
    root.tags = next;
    if (root.tags.indexOf(root.currentTag) === -1)
      root.currentTag = root.tags[0];
    // A queued tag that no longer exists would jam the queue at block
    // end. Drop it from the queue now and persist the filtered queue.
    // (If this write is refused, the block-end shift skips unknown
    // tags, so the queue still cannot jam.)
    var q = Model.filterSchedule(root.tagSchedule, root.tags);
    if (JSON.stringify(q) !== JSON.stringify(root.tagSchedule)) {
      if (root.writeTagJson("tagSchedule", q))
        root.tagSchedule = q;
    }
    return true;
  }

  // Tag schedule: queue a tag for an upcoming block, drop a queued tag,
  // save the queue as a named preset, load a preset into the queue, or
  // delete a preset. All persist to focusd.json. Loading a preset
  // replaces the queue; the current block keeps its tag — the queue
  // applies to the blocks after it.
  function enqueueTag(tag) {
    var next = Model.enqueueTag(root.tagSchedule, tag, root.tags);
    if (next === null)
      return false;
    if (!root.writeTagJson("tagSchedule", next))
      return false;
    root.tagSchedule = next;
    return true;
  }

  function removeScheduledTag(index) {
    var next = Model.removeScheduledTag(root.tagSchedule, index);
    if (next === null)
      return false;
    if (!root.writeTagJson("tagSchedule", next))
      return false;
    root.tagSchedule = next;
    return true;
  }

  function saveSchedulePreset(name) {
    var next = Model.saveSchedulePreset(root.tagSchedulePresets, name, root.tagSchedule);
    if (next === null)
      return false;
    if (!root.writeTagJson("tagSchedulePresets", next))
      return false;
    root.tagSchedulePresets = next;
    return true;
  }

  function loadSchedulePreset(name) {
    var next = Model.loadSchedulePreset(root.tagSchedulePresets, name);
    if (next === null)
      return false;
    if (!root.writeTagJson("tagSchedule", next))
      return false;
    root.tagSchedule = next;
    return true;
  }

  function deleteSchedulePreset(name) {
    var next = Model.deleteSchedulePreset(root.tagSchedulePresets, name);
    if (next === null)
      return false;
    if (!root.writeTagJson("tagSchedulePresets", next))
      return false;
    root.tagSchedulePresets = next;
    return true;
  }

  // Open the log of completed blocks: the Obsidian Focus Log when the
  // sync path is set, otherwise the sessions log itself. The URL comes
  // from Model.fileUrl, which escapes spaces and also "#" and "?" (those
  // would otherwise start the URL's fragment and query).
  function openLog() {
    var p = root.focusLogPath || root.sessionsPath;
    Qt.openUrlExternally(Model.fileUrl(p));
  }

  Timer {
    id: configWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (configProc.running) {
        configProc.timedOut = true;
        root.killProc(configProc);
      }
    }
  }

  Timer {
    id: patternsWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (patternsProc.running) {
        patternsProc.timedOut = true;
        patternsProc.collected = "";
        patternsProc.collectedBytes = 0;
        root.killProc(patternsProc);
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
    if (durationsProc.running || root.writePending(root.focusdConfigPath))
      return;
    durationsProc.collected = "";
    durationsProc.collectedBytes = 0;
    durationsProc.overflowed = false;
    durationsProc.timedOut = false;
    durationsProc.command = ["bash", root.readScriptPath, root.focusdConfigPath, String(root.maxConfigBytes)];
    durationsWatchdog.restart();
    durationsProc.readSeq = root.focusdWriteSeq;
    durationsProc.running = true;
  }

  function applyDurations(ok, raw) {
    var next = ok ? String(raw || "") : "";
    if (root.pendingPresetOp !== "" || root.pendingWrite) {
      // A preset switch / Save As and/or a slider release is waiting on
      // this fresh read. Apply the slider first, then the preset op, on
      // top of the fresh text — the other sliders may hold stale values,
      // so only the released key is ever passed in. If the read failed,
      // write nothing; the next poll snaps the panel back. A write that
      // changes nothing is skipped.
      var op = root.pendingPresetOp;
      var arg = root.pendingPresetArg;
      var kind = root.pendingWriteKind;
      var value = root.pendingWriteValue;
      var prev = root.pendingPresetPrev;
      root.pendingPresetPrev = "";
      root.pendingPresetOp = "";
      root.pendingPresetArg = "";
      root.pendingWrite = false;
      root.pendingWriteKind = "";
      if (ok) {
        var updated = next;
        // The slider's value belongs to the preset that was active when
        // it was released, so apply it first: switching the preset
        // first would write the old preset's value into the new
        // preset's section. A failed op keeps the changes that did
        // land, rather than resetting to the fresh text.
        if (kind) {
          var dur = Model.updateDuration(updated, kind, value);
          if (dur !== null)
            updated = dur;
        }
        if (op === "setPreset") {
          var preset = Model.setActivePreset(updated, arg);
          if (preset !== null)
            updated = preset;
        } else if (op === "savePreset") {
          var saved = Model.savePresetAs(updated, arg, root.workMinutes, root.shortBreakMinutes, root.longBreakMinutes);
          if (saved !== null)
            updated = saved;
        }
        if (updated !== next) {
          // Run through bash explicitly: the script's executable bit does
          // not survive a push through the GitHub API, and bash reads it
          // either way.
          root.queueWrite(root.focusdConfigPath, ["bash", root.writeScriptPath, root.focusdConfigPath], updated);
        }
        // Show the written state now: the write lands asynchronously, and
        // the panel binds to the presets, the active preset and the lengths.
        applyParsedDurations(updated);
      } else if (prev !== "") {
        // The fresh read failed, so the pick did not land: show the preset the
        // file had. A failed write is different: the next poll snaps it back.
        root.activePreset = prev;
      }
      // Force the next poll to re-read and re-apply. The file may not hold
      // `updated` yet, and a failed write or read must snap the panel back
      // to the file's values, which only a re-apply does.
      root.durationsRaw = "";
      return;
    }
    if (next === root.durationsRaw && root.durationsApplied)
      return;
    root.durationsRaw = next;
    root.durationsApplied = true;
    applyParsedDurations(next);
  }

  // Set the Durations state from focusd's config.toml text: the preset list,
  // the active preset and its three lengths. Unparseable text keeps the last
  // good values.
  function applyParsedDurations(text) {
    var parsed = Model.parseDurations(text);
    if (!parsed)
      return;
    root.presets = Model.listPresets(text);
    root.activePreset = parsed.preset;
    root.workMinutes = parsed.work;
    root.shortBreakMinutes = parsed.shortBreak;
    root.longBreakMinutes = parsed.longBreak;
  }

  // Switch the active preset (from the panel menu). Re-reads
  // config.toml fresh, then writes the new active_preset on top of that
  // fresh text (in applyDurations) — the cached text can be up to 10s
  // old, so writing from it could overwrite a change made in the focusd
  // TUI in that window. The 10s poll re-reads the file and confirms the
  // write; if it failed, the menu snaps back to the file's preset.
  function setActivePreset(name) {
    if (root.presets.indexOf(String(name)) === -1)
      return;
    if (String(name) === root.activePreset)
      return;
    // The picker follows activePreset, so the pick shows now. The fresh read
    // decides whether it sticks; a failed read puts the old preset back.
    if (root.pendingPresetOp !== "setPreset")
      root.pendingPresetPrev = root.activePreset;
    root.activePreset = String(name);
    root.pendingPresetOp = "setPreset";
    root.pendingPresetArg = String(name);
    root.loadDurations();
  }

  // Save the current slider values as a preset (new or existing) and
  // make it active. Same fresh re-read as a preset switch.
  function savePresetAs(name) {
    if (Model.validPresetName(name) === null)
      return;
    root.pendingPresetOp = "savePreset";
    root.pendingPresetArg = String(name).trim();
    root.loadDurations();
  }

  // A slider release re-reads config.toml fresh, then writes only the
  // released slider's key on top of that fresh text (in applyDurations).
  // The cached text can be up to 10s old, so writing from it could
  // overwrite a change made in the focusd TUI in that window — and the
  // other sliders still hold their (now stale) values, so only the
  // released key is ever passed in. The 10s poll re-reads the file and
  // confirms the write; if it failed, the sliders snap back to the
  // file's values. The in-memory slider value is updated immediately so
  // a Save As in the same poll sees it.
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
  // sessionsLoadedOk. An edit never writes from that log: it is applied to
  // a fresh read, and dropped with a warning when that read fails.
  function loadSessions() {
    if (sessionsProc.running || root.writePending(root.sessionsPath))
      return;
    // Edits queued before this read starts are its batch: the read is fresh
    // from this moment, and the batch is applied to its text.
    sessionsProc.batch = root.sessionsEdits;
    root.sessionsEdits = [];
    sessionsProc.stderrBytes = 0;
    sessionsProc.overflowed = false;
    sessionsProc.timedOut = false;
    sessionsProc.command = ["bash", root.readScriptPath, root.sessionsPath, String(root.sessionsMaxBytes)];
    sessionsWatchdog.restart();
    sessionsProc.running = true;
  }

  // Show a sessions log text in the panel: the in-memory copy, its entries
  // and the Last block (null when the text holds no valid entry).
  function showSessions(text) {
    root.sessionsRaw = text;
    root.sessionLog = Model.parseSessionLog(text);
    root.lastWorkSession = root.sessionLog.length ? root.sessionLog[root.sessionLog.length - 1] : null;
  }

  function applySessions(ok, raw) {
    if (!ok) {
      // The read failed (overflow, timeout, or an I/O error). Keep the
      // last good log exactly as it is — do not treat the failure as an
      // empty log — and mark the log unloaded so the Focus Log is not
      // exported until a read succeeds again.
      root.sessionsLoadedOk = false;
      return;
    }
    root.sessionsLoadedOk = true;
    var next = String(raw || "");
    if (next === root.sessionsRaw && root.sessionsApplied)
      return;
    root.sessionsApplied = true;
    root.showSessions(next);
  }

  // Sessions log edits: the block-end append and the Last-row retag. An edit
  // is never written from sessionsRaw. It waits in sessionsEdits until a read
  // of the file starts (loadSessions, which first waits out any read or write
  // already running), and that read's text is what the edits are applied to
  // (applySessionBatch). Anything that changed the file since the last poll
  // is therefore kept, and a change made after that read is kept by the
  // guarded write (queueSessionsWrite).
  function queueSessionEdit(edit) {
    root.sessionsEdits.push(edit);
    root.runSessionEdits();
  }
  function runSessionEdits() {
    if (root.sessionsEdits.length > 0)
      root.loadSessions();
  }

  // Applies a read's batch of edits to the text that read returned, and
  // writes the result once. A failed read applies and writes nothing: each
  // edit is dropped with a warning, and the panel goes back to the last log
  // read. A skipped edit (Model.applySessionEdit) is warned about; the edits
  // after it still apply to the text they were given.
  function applySessionBatch(batch, ok, text) {
    if (!ok) {
      for (var i = 0; i < batch.length; i++)
        console.warn(Model.sessionEditSkipMessage(root.sessionsPath, batch[i], "could not read the file"));
      root.showSessions(root.sessionsRaw);
      return;
    }
    var next = text;
    var applied = [];
    for (var j = 0; j < batch.length; j++) {
      var result = Model.applySessionEdit(next, batch[j], root.sessionsMaxBytes);
      if (result.skip) {
        console.warn(Model.sessionEditSkipMessage(root.sessionsPath, batch[j], result.skip));
        continue;
      }
      next = result.text;
      applied.push(batch[j]);
    }
    root.showSessions(next);
    if (applied.length === 0)
      return;
    if (next === text) {
      root.writeFocusLog();
      return;
    }
    // The export is regenerated only once the sessions write has landed. A
    // refused or killed write must not leave a block in the export that the
    // sessions log lacks.
    root.queueSessionsWrite(text, next, applied, function (ok) {
      if (ok)
        root.writeFocusLog();
    });
  }

  // Writes the edited sessions log through the write queue as a guarded
  // write (write-config --create --expect). base is the text the edits were
  // applied to (the batch's read) and text is the result: write-config
  // replaces the file only while it still holds base. On a conflict (exit
  // FILE_CHANGED_EXIT) nothing is written and the edits go back to the
  // front of the queue to be applied to a fresh read, up to a limit
  // (retryConflictedEdits). Any other failure is warned about; the next read
  // shows the disk. onDone(ok), when given, runs once the write has finished,
  // before queued edits resume.
  function queueSessionsWrite(base, text, edits, onDone) {
    var path = root.sessionsPath;
    root.queueFramedWrite(path, ["bash", root.writeScriptPath, "--create", "--expect", path], Model.writeConfigGuardedInput(base, text), function (ok, exitCode, timedOut) {
      if (!ok && !timedOut && exitCode === Model.FILE_CHANGED_EXIT) {
        var r = Model.retryConflictedEdits(edits);
        for (var i = 0; i < r.dropped.length; i++)
          console.warn(Model.sessionEditSkipMessage(path, r.dropped[i], "the file kept changing, gave up after " + Model.EDIT_MAX_CONFLICTS + " conflicts"));
        for (var k = 0; k < r.retry.length; k++)
          console.warn(Model.sessionEditSkipMessage(path, r.retry[k], "the file changed after it was read, retrying from the file"));
        root.sessionsEdits = r.retry.concat(root.sessionsEdits);
      } else if (!ok) {
        console.warn("Focusd: sessions log write failed for " + path + " (" + (timedOut ? "timed out" : "exit " + exitCode) + ")");
      }
      if (onDone)
        onDone(ok);
      root.runSessionEdits();
    });
  }

  // Block tagging: pick the tag for the current/next work block.
  function setCurrentTag(tag) {
    if (root.tags.indexOf(tag) !== -1)
      root.currentTag = tag;
  }

  // Fix the last completed block's tag afterwards: cycle it to the next
  // category. The edit names the block the panel shows and is applied only
  // if that block is still the last one on disk. Nothing to fix when no
  // block has completed yet, or there is no other tag to cycle to.
  function cycleLastTag() {
    var shown = root.lastWorkSession;
    if (!shown)
      return;
    var next = Model.nextTag(root.tags, shown.tag);
    if (!next)
      return;
    root.queueSessionEdit({ kind: "retag", tag: next, expect: { date: shown.date, tag: shown.tag, minutes: shown.minutes } });
    // The panel shows the new tag at once; the log settles on the next read.
    root.lastWorkSession = { date: shown.date, tag: next, minutes: shown.minutes };
  }

  Timer {
    id: sessionsWatchdog
    interval: root.configTimeoutMs
    repeat: false
    onTriggered: {
      if (sessionsProc.running) {
        sessionsProc.timedOut = true;
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
      root.loadPatterns();
    }
  }

  Process {
    id: durationsProc
    property string collected: ""
    property int collectedBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    property int readSeq: 0
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
      // A focusd write queued since this read started makes its text stale,
      // and a write still pending makes it older than what is queued. Drop
      // the read: the write's exit reloads the durations, and the next poll
      // reads again.
      if (durationsProc.readSeq !== root.focusdWriteSeq || root.writePending(root.focusdConfigPath))
        return;
      root.applyDurations(ok, output);
    }
  }

  Process {
    id: sessionsProc
    property int stderrBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    property var batch: []
    // Collected whole, exactly as the file holds it. A line splitter would
    // add a "\n" to a last line that has none, and the guarded write compares
    // this text byte for byte with the file. read-config already caps the
    // output at the sessions cap, so stdout needs no overflow check.
    stdout: StdioCollector {
      id: sessionsOut
      waitForEnd: true
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (sessionsProc.overflowed || sessionsProc.timedOut)
          return;
        sessionsProc.stderrBytes += String(data + "\n").length;
        if (sessionsProc.stderrBytes > root.sessionsMaxBytes) {
          sessionsProc.overflowed = true;
          sessionsProc.stderrBytes = 0;
          root.killProc(sessionsProc);
        }
      }
    }
    onExited: function (exitCode) {
      sessionsWatchdog.stop();
      var ok = !sessionsProc.overflowed && !sessionsProc.timedOut && exitCode === 0;
      var output = String(sessionsOut.text);
      var batch = sessionsProc.batch;
      sessionsProc.batch = [];
      sessionsProc.stderrBytes = 0;
      sessionsProc.overflowed = false;
      sessionsProc.timedOut = false;
      root.applySessions(ok, output);
      if (batch.length > 0)
        root.applySessionBatch(batch, ok, output);
      root.runSessionEdits();
    }
  }

  Process {
    id: configProc
    property int stderrBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    property var batch: []
    property bool exportAfter: false
    // Collected whole, exactly as the file holds it: the guarded write
    // compares this text byte for byte with the file, and a line splitter
    // would add a "\n" to a last line that has none. read-config already
    // caps the output at maxConfigBytes, so stdout needs no overflow check.
    stdout: StdioCollector {
      id: configOut
      waitForEnd: true
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (configProc.overflowed || configProc.timedOut)
          return;
        configProc.stderrBytes += String(data + "\n").length;
        if (configProc.stderrBytes > root.maxConfigBytes) {
          configProc.overflowed = true;
          configProc.stderrBytes = 0;
          root.killProc(configProc);
        }
      }
    }
    onExited: function (exitCode) {
      configWatchdog.stop();
      var ok = !configProc.overflowed && !configProc.timedOut && exitCode === 0;
      var output = String(configOut.text);
      var batch = configProc.batch;
      var exportAfter = configProc.exportAfter;
      configProc.batch = [];
      configProc.exportAfter = false;
      configProc.stderrBytes = 0;
      configProc.overflowed = false;
      configProc.timedOut = false;
      root.applyConfigRead(ok, output, batch, exportAfter);
    }
  }

  Process {
    id: patternsProc
    property string collected: ""
    property int collectedBytes: 0
    property bool overflowed: false
    property bool timedOut: false
    stdout: SplitParser {
      onRead: function (data) {
        if (patternsProc.overflowed || patternsProc.timedOut)
          return;
        var chunk = String(data + "\n");
        if (patternsProc.collectedBytes + chunk.length > root.maxConfigBytes) {
          patternsProc.overflowed = true;
          patternsProc.collected = "";
          patternsProc.collectedBytes = 0;
          root.killProc(patternsProc);
          return;
        }
        patternsProc.collected += chunk;
        patternsProc.collectedBytes += chunk.length;
      }
    }
    stderr: SplitParser {
      onRead: function (data) {
        if (patternsProc.overflowed || patternsProc.timedOut)
          return;
        patternsProc.collectedBytes += String(data + "\n").length;
        if (patternsProc.collectedBytes > root.maxConfigBytes) {
          patternsProc.overflowed = true;
          patternsProc.collected = "";
          patternsProc.collectedBytes = 0;
          root.killProc(patternsProc);
        }
      }
    }
    onExited: function (exitCode) {
      patternsWatchdog.stop();
      var ok = !patternsProc.overflowed && !patternsProc.timedOut && exitCode === 0;
      var output = String(patternsProc.collected);
      patternsProc.collected = "";
      patternsProc.collectedBytes = 0;
      patternsProc.overflowed = false;
      patternsProc.timedOut = false;
      root.applyPatterns(ok, output);
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
      // slider value. The log is written from a fresh read of the file
      // (queueSessionEdit), never from the in-memory copy: a block is dropped,
      // with a warning, only when that read or its validation fails.
      // (write-config --create creates the log file on the first block.)
      var blockLength = root.blockStartWorkMinutes > 0 ? root.blockStartWorkMinutes : root.workMinutes;
      var blockMinutes = Model.elapsedMinutes(blockLength, root.prevRemainingSecs);
      var entry = { date: Qt.formatDate(new Date(), "yyyy-MM-dd"), tag: root.currentTag, minutes: blockMinutes };
      // The panel shows the block at once; the file gets it on a fresh read.
      root.lastWorkSession = entry;
      root.queueSessionEdit({ kind: "append", entry: entry });
      // Tag schedule: the block that just ended was tagged with the
      // current tag, so take the next scheduled tag for the block after
      // it. An empty queue leaves the current tag alone. The shift
      // skips tags that are no longer categories; a queue holding only
      // such tags is drained so it cannot jam the next block end.
      var shifted = Model.shiftSchedule(root.tagSchedule, root.tags);
      if (shifted) {
        root.tagSchedule = shifted.schedule;
        root.currentTag = shifted.tag;
        root.writeTagJson("tagSchedule", shifted.schedule);
      } else if (root.tagSchedule.length) {
        root.tagSchedule = [];
        root.writeTagJson("tagSchedule", []);
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
      if (Model.shouldLaunchBreather(sessionKey, newStatus, root.breatherLaunchedFor, root.breakPattern, breakMinutes, root.breatherEnabled, root.breatherAutoLaunch)) {
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

  // The one write-config Process (see queueWrite). Its exit is what
  // drains the queue, so the handler must always run: a killed write
  // exits too.
  Process {
    id: configWriteProc
    stdinEnabled: true
    onStarted: configWriteProc.write(root.activeWrite.input)
    onExited: function (exitCode) {
      writeWatchdog.stop();
      var job = root.activeWrite;
      root.activeWrite = null;
      var ok = Model.writeSucceeded(exitCode, job.timedOut);
      if (job.onExit)
        job.onExit(ok, exitCode, job.timedOut);
      else if (!ok)
        console.warn("Focusd: write failed for " + job.path + " (" + (job.timedOut ? "timed out" : "exit " + exitCode) + ")");
      root.drainWrites();
      // A slider release or preset pick that waited on a write is applied now,
      // not on the next 10s poll. loadDurations skips while another focusd
      // write is still pending, and that write's exit runs this again.
      if (root.pendingWrite || root.pendingPresetOp !== "")
        root.loadDurations();
    }
  }

  Timer {
    id: writeWatchdog
    interval: root.writeTimeoutMs
    repeat: false
    onTriggered: {
      if (configWriteProc.running) {
        // Marked before the kill: the exit that follows can still report 0.
        root.activeWrite.timedOut = true;
        root.killProc(configWriteProc);
      }
    }
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
    root.loadPatterns();
  }
  Component.onDestruction: {
    if (FocusdShared.ServiceBridge.service === root)
      FocusdShared.ServiceBridge.service = null;
  }
}
