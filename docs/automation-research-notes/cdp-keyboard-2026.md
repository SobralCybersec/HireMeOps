# CDP `Input.dispatchKeyEvent` — reliable keyboard forwarding (research, 2026-08-03)

Context: forwarding DOM `KeyboardEvent` from a canvas → headless Chromium via chromiumoxide 0.7
`DispatchKeyEventParams`. The canonical reference implementations are Puppeteer / pyppeteer
(`keyboard.down/up/sendCharacter`) and Chrome's own `USKeyboardLayout`. Everything below is
verified against those.

## TL;DR of the whole thing

- Chrome decides "did a character get inserted?" purely by whether the event `type` is
  **`keyDown`** (char inserted, `keypress`/`input`/`beforeinput` fire) vs **`rawKeyDown`**
  (no char, navigation/control keys only). And Chrome only treats it as `keyDown` when you also
  supply a non-empty **`text`** field.
- So: **printable char = one `keyDown` WITH `text` set, then `keyUp`.** No separate `char`
  event needed. A lone `keyDown`/`rawKeyDown` with `text` empty inserts nothing — this is the
  #1 reason "typing doesn't register."
- **Enter needs `text: "\r"`** to submit/behave like a real Return. Backspace/Tab/arrows/Delete
  etc. take **NO text** (send as `rawKeyDown`+`keyUp`).
- Do **not** stuff `keyCode`/`charCodeAt(0)` into `windowsVirtualKeyCode` for punctuation — ASCII
  codes collide with VK codes (`.`=46=VK_DELETE, `[`=91=VK_LWIN, `!`=33=VK_PRIOR). Use a proper
  VK map or just leave `windowsVirtualKeyCode=0` and rely on `text` for printables.

---

## 1. Printable character — exact sequence & fields

Reference logic (pyppeteer/puppeteer `down()`), verbatim shape:

```
Input.dispatchKeyEvent {
  type: text ? 'keyDown' : 'rawKeyDown',   // text present => keyDown
  modifiers: <bitmask>,
  windowsVirtualKeyCode: description.keyCode,
  nativeVirtualKeyCode:  description.keyCode,   // set equal to windows VK
  code: description.code,        // e.g. "KeyA", "Digit1", "Period"
  key:  description.key,         // e.g. "a" / "A" / "."
  text: text,                    // the produced glyph, e.g. "A"
  unmodifiedText: text,          // same glyph w/o ctrl/alt (shift still applied)
  autoRepeat: false,
  location: description.location, // 0 for main keyboard
  isKeypad: description.location === 3,
}
```
then `keyUp`:
```
Input.dispatchKeyEvent {
  type: 'keyUp',
  modifiers, key, code,
  windowsVirtualKeyCode, nativeVirtualKeyCode,
  location,
}
```

Answers to the specific questions:
- **Order/types:** `keyDown` (with `text`) → `keyUp`. That is the complete flow for a printable.
- **Does a single `keyDown` with `text` insert the char?** YES. When `text` is non-empty Chrome
  synthesizes `keypress` + `beforeinput` + `input` internally and inserts the glyph. You do
  **NOT** need a separate `char` or `keypress` event.
- **When IS a separate `char` used?** Only `Keyboard.sendCharacter()` for glyphs with no physical
  key (emoji, IME output). That sends `type:'char'` with `text/key/unmodifiedText` = the char and
  **no** keydown/keyup — it fires only `keypress`/`input`, bypassing `keydown`. Not what you want
  for normal typing.
- **Required fields for a printable:** `type`, `key`, `code`, `text`, `unmodifiedText`. Strongly
  recommended: `windowsVirtualKeyCode` (letters/digits = ASCII of uppercase; punctuation = its
  VK_OEM code), `nativeVirtualKeyCode` (= windows VK). `location`/`isKeypad` only matter for
  numpad. `modifiers` = current held modifiers.
- **Capitals:** set `key:"A"`, `text:"A"`, `code:"KeyA"`, `modifiers` includes Shift (8). VK is
  still 65 (`A`). Don't send an independent Shift keyDown unless you also model shift press/release.

---

## 2. Non-text keys — Enter, Backspace, Tab, Escape, arrows, Delete, Home/End

These are dispatched as `rawKeyDown` (no `text`) then `keyUp` — **except Enter**, which carries
`text:"\r"` and therefore rides the `keyDown` path.

| Key        | key          | code         | windows/nativeVK | text  | type on down |
|------------|--------------|--------------|------------------|-------|--------------|
| Enter      | `Enter`      | `Enter`      | 13               | `\r`  | `keyDown`    |
| Backspace  | `Backspace`  | `Backspace`  | 8                | —     | `rawKeyDown` |
| Tab        | `Tab`        | `Tab`        | 9                | —     | `rawKeyDown` |
| Escape     | `Escape`     | `Escape`     | 27               | —     | `rawKeyDown` |
| ArrowLeft  | `ArrowLeft`  | `ArrowLeft`  | 37               | —     | `rawKeyDown` |
| ArrowUp    | `ArrowUp`    | `ArrowUp`    | 38               | —     | `rawKeyDown` |
| ArrowRight | `ArrowRight` | `ArrowRight` | 39               | —     | `rawKeyDown` |
| ArrowDown  | `ArrowDown`  | `ArrowDown`  | 40               | —     | `rawKeyDown` |
| Delete     | `Delete`     | `Delete`     | 46               | —     | `rawKeyDown` |
| Home       | `Home`       | `Home`       | 36               | —     | `rawKeyDown` |
| End        | `End`        | `End`        | 35               | —     | `rawKeyDown` |

Notes:
- **Enter is the trap.** Chrome's `USKeyboardLayout` defines Enter with `text:"\r"`. Without it,
  many `<form>`/search inputs won't submit and framework `onKeyDown`+`input` handlers behave oddly.
  Send `text:"\r"` (and `unmodifiedText:"\r"`), which puts it on the `keyDown` path.
- Backspace/Delete deliberately have **no text**; the deletion is Chrome's default action of the
  `keyDown`, not a text insertion. If you accidentally set `text` on Backspace you can get a
  literal char inserted instead of a delete.
- Tab: in `USKeyboardLayout` Tab has no `text` — send as rawKeyDown. (Chrome moves focus as the
  default action.) A stray `\t` text can insert a tab character in `<textarea>`.
- `windowsVirtualKeyCode` MUST be correct for these — they have no `text`, so the VK is the ONLY
  thing that identifies the key. A wrong VK = key silently ignored or mis-actioned.

---

## 3. `modifiers` bitmask

Bit field, OR the bits of currently-held modifiers:

| Modifier            | Bit |
|---------------------|-----|
| Alt                 | 1   |
| Ctrl / Control      | 2   |
| Meta / Command / ⊞  | 4   |
| Shift               | 8   |

Usage:
- Capital `A`: `modifiers = 8`, `key:"A"`, `text:"A"`.
- Ctrl+A (select all): `modifiers = 2`, `key:"a"`, `code:"KeyA"`, VK 65, and **omit `text`**
  (a chord with Ctrl/Alt/Meta produces no text → send as `rawKeyDown`). With `text` set, Chrome
  may insert "a" instead of firing the shortcut.
- Ctrl+Shift+I: `modifiers = 2|8 = 10`.
- From a DOM `KeyboardEvent` you can rebuild the mask directly:
  `(e.altKey?1:0) | (e.ctrlKey?2:0) | (e.metaKey?4:0) | (e.shiftKey?8:0)`.

---

## 4. Common failure modes forwarding DOM `KeyboardEvent` → CDP (and fixes)

1. **Char never inserts (typing "does nothing").** You sent `rawKeyDown` or a `keyDown` with an
   empty `text`. Fix: for printables set `text` (and `unmodifiedText`) to the produced glyph so
   the event becomes a real `keyDown`. This alone fixes most "some keys don't register."

2. **Using `e.keyCode`/`e.charCodeAt(0)` as `windowsVirtualKeyCode` for punctuation.** ASCII of
   `.`,`!`,`[` etc. collides with VK codes → `.`→VK_DELETE, `[`→VK_LWIN, `!`→VK_PageUp. The key
   gets treated as a navigation/system key. Fix: for printables rely on `text` and set VK from a
   proper map (VK_OEM_PERIOD=190, VK_OEM_4=`[`=219, digits/letters = ASCII of the uppercase form),
   or set VK=0 for printables and let `text` carry it. (vercel-labs/agent-browser #1380, 2026-05-21.)

3. **Enter doesn't submit.** Missing `text:"\r"`. Fix: add it (see §2).

4. **Backspace/arrows ignored.** Wrong or missing `windowsVirtualKeyCode` (these have no text, so
   VK is everything), or sent as `keyDown` with a bogus `text`. Fix: correct VK (8/37-40/46…),
   no text, `rawKeyDown`.

5. **No focused element.** CDP dispatches to the focused node; if focus is on `<body>` nothing
   lands in an input. Fix: click/focus the target element first (via `Input.dispatchMouseEvent`
   or `element.focus()` in the page) before typing.

6. **Missing `code`.** Frameworks (React, and libs keying off `event.code`) may drop the key.
   Always send `code` ("KeyA", "Digit1", "Enter", "ArrowUp", "Period"), not just `key`.

7. **Down without matching up (or vice-versa).** Sticky modifiers / auto-repeat weirdness. Always
   pair `keyDown`/`rawKeyDown` with a `keyUp` carrying the same `key`/`code`/VK.

8. **Shift handled as text-casing only.** Sending `key:"a"` with Shift in modifiers but `text:"a"`
   yields lowercase. Set the SHIFTED glyph in `text`/`key` yourself ("A", "!", "@") — CDP does not
   re-derive the shifted character for you; it takes `text` verbatim.

9. **Sending `char` for everything.** `type:'char'` skips `keydown`/`keyup`, so key handlers,
   shortcuts, and `code`-based logic never fire. Use down/up with `text`, not `char`.

---

## 5. Recommended mapping: DOM event → CDP params + canonical sequences

DOM → CDP field mapping:
```
CDP.key                   = e.key
CDP.code                  = e.code
CDP.windowsVirtualKeyCode = vkFor(e)      // see below, NOT e.charCodeAt(0)
CDP.nativeVirtualKeyCode  = same as windows VK
CDP.location              = e.location    // 0 normal, 3 numpad
CDP.isKeypad              = e.location === 3
CDP.modifiers             = (e.altKey?1:0)|(e.ctrlKey?2:0)|(e.metaKey?4:0)|(e.shiftKey?8:0)
CDP.text / unmodifiedText = (printable && no ctrl/alt/meta) ? e.key : ("Enter" ? "\r" : "")
```
`vkFor(e)`:
- letters: `e.key.toUpperCase().charCodeAt(0)` (A–Z = 65–90)
- digits (top row): 48–57
- named keys: fixed table (Enter 13, Backspace 8, Tab 9, Escape 27, ArrowLeft/Up/Right/Down
  37/38/39/40, Delete 46, Home 36, End 35, Space 32)
- punctuation: VK_OEM_* map (`;`/`:`=186, `=`/`+`=187, `,`/`<`=188, `-`/`_`=189, `.`/`>`=190,
  `/`/`?`=191, `` ` ``/`~`=192, `[`/`{`=219, `\`/`|`=220, `]`/`}`=221, `'`/`"`=222)
- fallback for anything printable: 0 (fine — `text` carries the glyph)

### (a) Printable char, e.g. "A" (shift held)
```
keyDown { key:"A", code:"KeyA", windowsVirtualKeyCode:65, nativeVirtualKeyCode:65,
          text:"A", unmodifiedText:"A", modifiers:8, location:0 }
keyUp   { key:"A", code:"KeyA", windowsVirtualKeyCode:65, nativeVirtualKeyCode:65, modifiers:8 }
```

### (b) Enter
```
keyDown { key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
          text:"\r", unmodifiedText:"\r", modifiers:0 }
keyUp   { key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 }
```

### (c) Backspace
```
rawKeyDown { key:"Backspace", code:"Backspace", windowsVirtualKeyCode:8,
             nativeVirtualKeyCode:8, modifiers:0 }        // NO text
keyUp      { key:"Backspace", code:"Backspace", windowsVirtualKeyCode:8, nativeVirtualKeyCode:8 }
```

### chromiumoxide 0.7 note
`DispatchKeyEventParams` field names are snake_case: `r#type` (via the `DispatchKeyEventType`
enum: `KeyDown`/`KeyUp`/`RawKeyDown`/`Char`), `windows_virtual_key_code`, `native_virtual_key_code`,
`unmodified_text`, `is_keypad`, `auto_repeat`, `location`, plus builder `.text(...)`, `.key(...)`,
`.code(...)`, `.modifiers(...)`. Use the builder and only `.text()` for printables + Enter.

---

## Sources
- Chrome DevTools Protocol — Input domain (tot), `Input.dispatchKeyEvent` param semantics
  (type enum keyDown/keyUp/rawKeyDown/char; text "not needed for keyUp and rawKeyDown"; modifiers
  Alt=1/Ctrl=2/Meta=4/Shift=8): https://chromedevtools.github.io/devtools-protocol/tot/Input/
- chromiumoxide `DispatchKeyEventParams` field list (docs.rs, current):
  https://docs.rs/chromiumoxide/latest/chromiumoxide/cdp/browser_protocol/input/struct.DispatchKeyEventParams.html
- pyppeteer `input.py` (mirrors Puppeteer) — exact down/up/sendCharacter logic incl.
  `type: 'keyDown' if text else 'rawKeyDown'` and `char` for sendCharacter:
  https://miyakogi.github.io/pyppeteer/_modules/pyppeteer/input.html
- Puppeteer keyboard docs (down/up/sendCharacter, keyDown vs rawKeyDown by text presence):
  https://pptr.dev/api/puppeteer.keyboard ; sendCharacter:
  https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.keyboard.sendcharacter.md
- vercel-labs/agent-browser Issue #1380 (2026-05-21) — canvas→CDP: never use ASCII charCode as
  windowsVirtualKeyCode for punctuation; use VK_OEM_* map:
  https://github.com/vercel-labs/agent-browser/issues/1380
