# OmoPomodorachy

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

The timer panel has duration sliders for the active preset's work, short break, and long break (work 5–90 min, short break 1–30, long break 5–60). They edit the active preset in Focusd's `~/.config/focusd/config.toml` — the same place `focusd settings` edits — and a change takes effect from the next session of that type, never mid-session. If you change durations in the Focusd TUI, the sliders pick them up within a few seconds. (Durations used to be set in Focusd itself only; the sliders are this fork's addition.) The sliders need `/usr/bin/python3` (present on Omarchy); if a slider change snaps back instead of sticking, that is the first thing to check.

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
