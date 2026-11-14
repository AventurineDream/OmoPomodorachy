#!/usr/bin/env python3
"""Tests for cli/ompo — run with `python3 test/ompo.test.py`.

Runs the real script against a stub `focusd` on PATH: the stub logs
every argv it receives and answers `status` with canned JSON, so the
read-only paths are checked live and the control paths are checked by
the exact `focusd` invocation they resolve to — without ever touching
a real timer. No shell needed.
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OMPO_PATH = os.path.join(HERE, "..", "cli", "ompo")

STUB = """#!/bin/sh
echo "$@" >> "$FOCUSD_STUB_LOG"
if [ "$1" = "status" ]; then cat "$FOCUSD_STUB_STATUS_FILE"; fi
exit 0
"""

# Canned `focusd status` JSON, mirroring the real 0.2.14 output.
PAUSED_WORK = {
    "text": "24:13", "alt": "work-paused", "class": ["work", "paused"],
    "percentage": 3,
    "tooltip": "Work Session,\nCycle 2/4\n\nNext Session: Short Break (5m),\n\nFocused today: 0s,\nCurrent Streak: 0 day\n",
    "session": "Work", "next_session": "Short Break", "sessions_today": 0,
    "focused_today": "0s", "daily_goal": "0s", "current_streak": 0,
    "work_sessions_before_long_break": 4, "completed_sessions": 1,
}
RUNNING_WORK = dict(PAUSED_WORK, alt="work", **{"class": ["work"]})
STOPPED = {
    "text": "", "alt": "stopped", "class": ["stopped"], "percentage": 0,
    "tooltip": "", "session": "", "next_session": "Work",
    "sessions_today": 0, "focused_today": "0s", "daily_goal": "0s",
    "current_streak": 0, "work_sessions_before_long_break": 4,
    "completed_sessions": 0,
}

pass_count = 0


def check(name, cond):
    global pass_count
    if not cond:
        print("FAIL:", name)
        sys.exit(1)
    pass_count += 1


class StubFocusd:
    """A temp dir with a stub `focusd` on PATH; records its argv."""

    def __init__(self, status):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.log = os.path.join(self.dir, "calls.log")
        self.status_file = os.path.join(self.dir, "status.json")
        with open(self.status_file, "w") as f:
            json.dump(status, f)
        with open(os.path.join(self.dir, "focusd"), "w") as f:
            f.write(STUB)
        os.chmod(os.path.join(self.dir, "focusd"), 0o755)
        open(self.log, "w").close()

    def run(self, *args, extra_env=None):
        env = dict(os.environ)
        env["PATH"] = self.dir + os.pathsep + env.get("PATH", "")
        env["FOCUSD_STUB_LOG"] = self.log
        env["FOCUSD_STUB_STATUS_FILE"] = self.status_file
        if extra_env:
            env.update(extra_env)
        proc = subprocess.run(
            ["bash", OMPO_PATH, *args],
            capture_output=True, text=True, env=env, timeout=30)
        calls = open(self.log).read().splitlines()
        return proc.returncode, proc.stdout, proc.stderr, calls

    def close(self):
        self.tmp.cleanup()


# --- status display (read-only, live against the stub) ---
stub = StubFocusd(PAUSED_WORK)
rc, out, err, calls = stub.run()
check("bare ompo exits 0", rc == 0)
check("bare ompo shows session + state", "Work · paused" in out)
check("bare ompo shows time left", "24:13 left" in out)
check("bare ompo shows elapsed percent", "3% elapsed" in out)
check("bare ompo shows cycle", "Cycle 2/4" in out)
check("bare ompo shows next session", "Next: Short Break (5m)" in out)
check("bare ompo shows focused today", "Focused today: 0s" in out)
check("bare ompo shows sessions + streak",
      "Sessions: 0" in out and "Streak: 0 days" in out)
check("bare ompo reads status exactly once", calls == ["status"])
rc, out, err, calls = stub.run("status")
check("ompo status matches bare ompo", rc == 0 and "Work · paused" in out)
stub.close()

stub = StubFocusd(RUNNING_WORK)
rc, out, err, calls = stub.run()
check("running timer shows running", rc == 0 and "Work · running" in out)
stub.close()

stub = StubFocusd(STOPPED)
rc, out, err, calls = stub.run()
check("stopped timer says no session", rc == 0 and "No session running." in out)
check("stopped timer points at ompo start", "ompo start" in out)
stub.close()

# --- help / usage errors ---
stub = StubFocusd(PAUSED_WORK)
for flag in ("--help", "-h", "help"):
    rc, out, err, calls = stub.run(flag)
    check("ompo %s exits 0 and documents start" % flag,
          rc == 0 and "ompo start" in out)
    check("ompo %s makes no focusd call" % flag, calls == [])
rc, out, err, calls = stub.run("bogus")
check("unknown command exits 2", rc == 2)
check("unknown command names the command", "bogus" in err)
rc, out, err, calls = stub.run("start", "bogus-session")
check("unknown session exits 2", rc == 2)
check("unknown session names the session", "bogus-session" in err)
rc, out, err, calls = stub.run("start", "work", "extra")
check("extra start arg exits 2", rc == 2)
rc, out, err, calls = stub.run("pause", "extra")
check("extra pause arg exits 2", rc == 2)
rc, out, err, calls = stub.run("resume", "extra")
check("extra resume arg exits 2", rc == 2)
rc, out, err, calls = stub.run("status", "extra")
check("extra status arg exits 2", rc == 2)
stub.close()

# --- control paths resolve to the right focusd invocation ---
stub = StubFocusd(PAUSED_WORK)
rc, out, err, calls = stub.run("start")
check("start on paused exits 0", rc == 0)
check("start on paused resumes (not restarts)",
      calls == ["status", "resume", "status"])
rc, out, err, calls = stub.run("start", "work")
check("start work on paused starts fresh, not resume",
      calls[-3:] == ["status", "-s work", "status"])
rc, out, err, calls = stub.run("resume")
check("resume on paused calls focusd resume",
      calls[-2:] == ["resume", "status"] and "resume" in calls)
stub.close()

stub = StubFocusd(STOPPED)
rc, out, err, calls = stub.run("start")
check("start on stopped starts the current session",
      calls == ["status", "-s", "status"])
rc, out, err, calls = stub.run("start", "work")
check("start work passes the session through",
      calls[-3:] == ["status", "-s work", "status"])
rc, out, err, calls = stub.run("start", "short-break")
check("start short-break passes the session through",
      "-s short-break" in calls)
stub.close()

stub = StubFocusd(RUNNING_WORK)
rc, out, err, calls = stub.run("start")
check("start on running is a no-op", rc == 0 and "Already running" in out)
check("start on running invokes nothing but status",
      calls == ["status", "status"])
rc, out, err, calls = stub.run("pause")
check("pause on running calls focusd pause", "pause" in calls)
stub.close()

stub = StubFocusd(PAUSED_WORK)
rc, out, err, calls = stub.run("pause")
check("pause on paused is a no-op", rc == 0 and "Already paused" in out)
check("pause on paused invokes nothing but status",
      calls == ["status", "status"])
stub.close()

stub = StubFocusd(STOPPED)
rc, out, err, calls = stub.run("pause")
check("pause on stopped is a no-op", rc == 0 and "Nothing running" in out)
check("pause on stopped invokes nothing but status", calls == ["status"])
rc, out, err, calls = stub.run("resume")
check("resume on stopped is a no-op",
      rc == 0 and "Nothing to resume" in out)
check("resume on stopped invokes nothing but status",
      calls[-1:] == ["status"] and "resume" not in calls)
stub.close()

stub = StubFocusd(RUNNING_WORK)
rc, out, err, calls = stub.run("resume")
check("resume on running is a no-op", rc == 0 and "Already running" in out)
check("resume on running invokes nothing but status",
      calls == ["status", "status"])
stub.close()

# `focusd start` is not a subcommand (0.2.14) and must never be called:
# every scenario above logged its argv, and none of them was `start`.
stub = StubFocusd(PAUSED_WORK)
for args in ((), ("status",), ("start",), ("pause",), ("resume",)):
    stub.run(*args)
rc, out, err, calls = stub.run("start")
check("ompo never invokes `focusd start`",
      all(c != "start" and not c.startswith("start ") for c in calls))
stub.close()

# --- dry run: prints the command, executes nothing ---
stub = StubFocusd(PAUSED_WORK)
rc, out, err, calls = stub.run("start", extra_env={"OMPO_DRY_RUN": "1"})
check("dry-run start prints the would-be command",
      rc == 0 and "would run: focusd resume" in out)
check("dry-run start executes nothing", calls == ["status"])
rc, out, err, calls = stub.run("pause", extra_env={"OMPO_DRY_RUN": "1"})
check("dry-run pause on paused stays a no-op",
      rc == 0 and "Already paused" in out)
rc, out, err, calls = stub.run("start", "work",
                                extra_env={"OMPO_DRY_RUN": "1"})
check("dry-run start work on paused prints a fresh start",
      rc == 0 and "would run: focusd -s work" in out)
check("dry-run start work on paused executes nothing",
      calls[-1:] == ["status"] and "-s work" not in calls)
stub.close()

stub = StubFocusd(STOPPED)
rc, out, err, calls = stub.run("start", "long-break",
                                extra_env={"OMPO_DRY_RUN": "1"})
check("dry-run start on stopped prints focusd -s",
      "would run: focusd -s long-break" in out)
check("dry-run start on stopped executes nothing", calls == ["status"])
stub.close()

# --- failure modes ---
stub = StubFocusd(PAUSED_WORK)
env = dict(os.environ)
env["PATH"] = stub.dir + os.pathsep + env.get("PATH", "")
env["FOCUSD_STUB_LOG"] = stub.log
env["FOCUSD_STUB_STATUS_FILE"] = stub.status_file
env["OMPO_FOCUSD"] = "/nonexistent/focusd"
proc = subprocess.run(["bash", OMPO_PATH], capture_output=True, text=True,
                      env=env, timeout=30)
check("missing focusd exits 1", proc.returncode == 1)
check("missing focusd says so", "not found" in proc.stderr)
stub.close()

# Garbage status output: not JSON at all.
stub = StubFocusd(PAUSED_WORK)
with open(stub.status_file, "w") as f:
    f.write("this is not json\n")
rc, out, err, calls = stub.run()
check("garbage status exits 1", rc == 1)
check("garbage status explains", "could not read" in err)
stub.close()

print("ompo: %d checks passed" % pass_count)
