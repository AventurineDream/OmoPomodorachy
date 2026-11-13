# OmaPomodorchy

A beautiful [Focusd](https://github.com/BibekBhusal0/focusd) pomodoro timer for the Omarchy bar. Shows the current session and remaining time with a state icon, and opens a control panel with pause, skip, and stop actions plus your streak, sessions, history, and daily goal.

![Focusd preview](preview.png)

## Why Another Pomodoro Timer

At the time of making this there are already two, similar plugin for omarchy in marketplace, but what does focusd do different than other plugins. First thing focusd is not just omarchy plugin, it's a TUI with features like streak, history, stats, and more. This plugin is just integration of omarchy with focusd. And to answer the question of how this differs from other plugin, focusd has TUI which is in-sync with bar, and other lovely features like goal, history, streak.

## Features

- Bar widget showing session state and remaining time
- Control panel with pause, skip, reset, and add 5 minutes
- Session progress dots showing current position in the pomodoro cycle
- Info page with links to GitHub, settings TUI, and stats TUI
- Automatic update checking for AUR installations
- Streak, daily goal, and sessions today from Focusd history
- Duration sliders for the active preset's work, short break, and long break (work 5–90 min, short break 1–30, long break 5–60)
- Customizable state icons
- Switchable popup style (linear hero or circular face)
- Full keyboard navigation support

## Requirements

- Omarchy quattro
- [Focusd](https://github.com/BibekBhusal0/focusd) v0.2.1+ (auto-installed on first use with SHA256 verification, or install from AUR: `yay -S focusd`)

## Install

```bash
omarchy plugin add https://github.com/AventurineDream/OmoPomodorachy.git --enable
```

## Demo

![Focusd Demo](demo.gif)

## Usage

Click the bar widget to open the control panel. Right-click skips to the next session, middle-click resets the current timer. The info button (i icon) at the bottom opens settings and stats access. You can also bind it to a key (`~/.config/hypr/bindings.lua`):

```lua
o.bind("CTRL", "T", "exec, omarchy-shell shell summon bibek.focusd")
```

Start the timer with `focusd start`. Press Escape in the info page to return to the timer page.

## Configuration

The timer panel has duration sliders for the active preset's work, short break, and long break (work 5–90 min, short break 1–30, long break 5–60). They edit the active preset in Focusd's `~/.config/focusd/config.toml` — the same place `focusd settings` edits — and a change takes effect from the next session of that type, never mid-session. If you change durations in the Focusd TUI, the sliders pick them up within a few seconds. (Durations used to be set in Focusd itself only; the sliders are this fork's addition.) The sliders need `/usr/bin/python3` (present on Omarchy); if a slider change snaps back instead of sticking, that is the first thing to check. The panel also has a tag picker for work blocks ("Tag this block") — tap a category before or during a block, and the block is recorded with that tag when it ends; the Last row lets you fix the tag of the block that just ended.

The plugin's options live in `~/.config/omarchy/focusd.json` (watched live, so edits apply instantly).

Default configuration:

```json
{
  "progressBarStyle": "linear",
  "icons": {
    "work": "",
    "work-paused": "󰏤",
    "short-break": "",
    "short-break-paused": "󰏤",
    "long-break": "󰒲",
    "long-break-paused": "󰏤"
  }
}
```

`progressBarStyle` switches the popup between the `linear` and `circular`:

```json
{ "progressBarStyle": "circular" }
```

`icons` overrides the per-state bar icons. Any of the keys above can be replaced:

`sounds` plays a gentle chime when one session ends and the next begins (a work session running out, or a break ending). It stays silent on pause, resume, and stop, and on a manual start after a stop. Skipping to the next session also ends the current one, so it chimes too — as long as the session was running; skipping from a paused session stays silent. On by default; set it to `false` to turn it off. `soundFile` picks the chime — a bare filename is resolved into the freedesktop sound theme (`complete.oga` by default), a full path is used as-is (`~` is not expanded, so write the path out):

```json
{ "sounds": true, "soundFile": "complete.oga" }
```

`breakPattern` links the timer to Terminal-Breather: when a break starts, the Breather overlay opens with that pattern, for the break's remaining time (rounded down, so it ends a little before the break). Any pattern works — the built-ins (`box`, `478`, `coherent`) and your customs from `~/.config/omarchy/zen/patterns.json` (for example `slow-6`, `calm-466`, `breath-of-fire`); a name that doesn't exist falls back to `box` inside the Breather, silently. It launches once per break, on the first poll where the break is running — a break that starts paused waits until you resume it, and pausing mid-break doesn't relaunch it. Set it to `""` to turn the link off:

```json
{ "breakPattern": "478" }
```

`rounds` stops the timer after that many work sessions in a run — set it to `4` and the timer stops after the fourth work session ends (the break is left paused, so it will not auto-start the next work session; resuming the break still opens the Breather). The panel shows the run's progress ("Rounds: 2 / 4 done"). `0` (the default) means off — run without a limit. A skipped work session counts as a round, the same way it counts for the chime. The count is in-memory: it resets when a run completes, when the daemon restarts, when the shell restarts, and when the day changes (sessions_today drops) — so a run stopped partway through yesterday starts fresh today, but stopping partway through a run and coming back later the same day picks up where it left off. Set it in the panel (Durations section, "Rounds" slider, 0–12, 0 is off) or in `focusd.json`:

```json
{ "rounds": 4 }
```

`tags` is the list of categories for work blocks, shown as a picker in the panel ("Tag this block"). Tap one before (or during) a work block and the block is recorded with that tag when it ends. The panel also shows the last completed block ("Last: Art · 25 min · 2026-11-11") — tap its tag to cycle it, if the block that just ended was something else. Completed blocks are recorded in `~/.config/omarchy/focusd-sessions.json` (one `{ date, tag, minutes }` entry per block, compact JSON on one line), which is the source the Obsidian sync (Phase 6) exports from. A block that runs out is logged at its full length; a skipped block is logged with the minutes actually spent, measured from the work length when the block started (changing the work slider mid-block does not mis-measure it). The log is read on the 10s poll with a 1 MiB cap, and a block is only written when the last read succeeded — if the read ever fails, the block is dropped rather than risking the log, and a retag is skipped the same way. The default list is `Work`, `Study`, `Art`, `Admin`, `Other` — set your own in `focusd.json`:

```json
{ "tags": ["Work", "Study", "Art", "Admin", "Other"] }
```

`focusLogPath` is where the Obsidian Focus Log goes — a generated markdown table of every completed work block. The whole table is regenerated from the sessions log every time a block ends or a block is retagged, so a retag in the panel updates the vault row too; the note says it is generated, so don't hand-edit its rows (the next block would overwrite them). The parent folder is created if it is missing. The sync is **off by default** — nothing is written to the vault until a path is set. To turn it on, set the path (the proposed location is `20_Practices/Focus/Focus Log.md` in the vault); an existing file at that path is only replaced when it starts with the generated header, so a hand-written note there is left alone:

```json
{ "focusLogPath": "/home/aven/Projects/Obsidian/Home/20_Practices/Focus/Focus Log.md" }
```

```json
"bar": {
  "layout": {
    "right": [
      {
        "id": "bibek.focusd",
        "icons": {
          "work": "🍅",
          "work-paused": "",
          "short-break": "☕",
          "short-break-paused": "",
          "long-break": "🏖️",
          "long-break-paused": ""
        }
      }
    ]
  }
}
```

Alternatives per state (pick the ones you like; `-paused` variants reuse the same pause icon or keep it same because the opacity is decreased):

| Key           | Suggestions   |
| ------------- | ------------- |
| `work`        | 󰅐, 󰀠, 🍅,    |
| `short-break` | ☕, 🍪, ,   |
| `long-break`  | 🏖️, ⏳, 🌴, 󰒲 |
| `paused`      | 󰏦, 󰏥, , 󰏤    |

## Uninstall

```bash
omarchy plugin remove bibek.focusd
```

## Credits

Bar widget and panel design adapted from [Omadoro](https://github.com/brianblakely/omadoro) by Brian Blakely, licensed under the MIT License.

Session progress dots visualization inspired by [omarchy-pomodoro](https://github.com/rodrigojacarei/omarchy-pomodoro) by rodrigojacarei, licensed under the MIT License.

This plugin is licensed under the [MIT License](LICENSE).

## Others

Here are my other Omarchy plugins:

- [Obsidian Search](https://github.com/BibekBhusal0/omarchy-obsidian-search) - fuzzy-search your Obsidian vault
- [Readest](https://github.com/BibekBhusal0/omarchy-readest) - fuzzy-search your Readest library
- [Youtube Video Downloader](https://github.com/BibekBhusal0/omarchy-ytdl) - video downloads with progress and history
- [Better Lock](https://github.com/BibekBhusal0/omarchy-better-lock) - lock screen with date/time, media and power controls
- [Better Media](https://github.com/BibekBhusal0/omarchy-better-media) - MPRIS now-playing with playback controls
- [Better Menu](https://github.com/BibekBhusal0/omarchy-better-menu) - fuzzy menu with app grid, calculator and web search

Please give a star if you find them useful!
