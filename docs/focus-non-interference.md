# Watching automations without losing your mouse/keyboard

The automation browser windows are **visible on purpose** — you (and the user)
should be able to watch them work and click in to intervene.

## What is NOT a problem

Playwright/patchright drive the page with **synthetic CDP events** (`page.click`,
`page.fill`, `page.mouse.move`). These are injected straight into Chromium's
renderer — they **never move your physical mouse cursor** and **never type into
your other windows**. The humanization mouse-moves in the scraper are safe; your
real cursor stays exactly where you left it. We also never call
`page.bringToFront()` (the one API that would raise/steal focus).

## The one real annoyance: focus theft on window open

When Chromium opens a new automation window it grabs keyboard focus and raises
over whatever you were doing. There is **no Chromium flag** to open a visible
window unfocused — this is the window manager's job. So the app tags every
automation window with a distinct class, **`HireMeOpsBot`** (via `--class`), and
you add a one-time rule so your WM stops *just those* windows from stealing focus
(your everyday browser is untouched, and the window stays fully visible + still
clickable when you want to watch or take over).

### Hyprland (Wayland) — add to `~/.config/hypr/hyprland.conf`

```conf
windowrulev2 = noinitialfocus, class:^(HireMeOpsBot)$
windowrulev2 = suppressevent activatefocus, class:^(HireMeOpsBot)$
```

- `noinitialfocus` — the window opens **without** grabbing your keyboard focus.
- `suppressevent activatefocus` — stops each new tab/page/dialog from re-stealing
  it (without this, `noinitialfocus` only covers the very first window).
- **Don't** use bare `nofocus` — that makes the window permanently unfocusable, so
  you couldn't click in to watch/intervene. The two rules above keep it visible
  and manually focusable on click, which is exactly what you want.
- Gotcha: don't also add a `monitor` rule for `HireMeOpsBot` — Hyprland can ignore
  `noinitialfocus` when a monitor rule is set for the same class (upstream #9365).

Reload with `hyprctl reload` (or restart Hyprland).

### GNOME (Mutter)

```sh
gsettings set org.gnome.desktop.wm.preferences focus-new-windows 'strict'
```

New windows signal instead of grabbing focus. This is global (not scoped to the
bot class) but effective.

### KDE (KWin)

System Settings → Window Management → **Window Rules** → New → match **Window
class** `HireMeOpsBot` → set **Focus stealing prevention: Extreme** and **Accept
focus: No (initial)**.

### Other X11 window managers

Most EWMH-compliant WMs honor `_NET_WM_USER_TIME` and have a "focus stealing
prevention" setting — enable it, or add a `devilspie2`/`wmctrl` rule keyed on the
`HireMeOpsBot` WM_CLASS to lower/unfocus the window on map.
