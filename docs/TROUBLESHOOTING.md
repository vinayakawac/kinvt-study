# Troubleshooting

## Running the .exe seems to do nothing

It opens the **Settings** window on launch precisely so you can tell it
started. If you closed that, it is still running in the tray.

On Windows 11 new tray icons go into the **overflow flyout** — click the `^`
chevron near the clock, and drag the Kinvt-study icon out to pin it.

## No quiz ever appears

1. Check **Quiz popups** is on in Settings.
2. Check **at least one Library topic is ticked**. With none selected,
   `buildQuiz()` returns `null` and nothing is shown, deliberately, rather
   than popping an empty card.
3. Try the tray's **Quiz me now** or **Ctrl+Shift+Q**. If the hotkey does
   nothing but the tray works, another app has claimed the combination —
   registration failure is logged, not fatal.
4. Otherwise the automatic popup is on its interval (15 min – 2 h). It is not
   broken, just not due yet.

### Tauri: the app runs, but no quiz ever appears

Tauri v2 gates the frontend's access to **core plugin APIs** behind a
capabilities file. Custom commands declared in `invoke_handler!` are exempt,
but `event.emit` / `event.listen` are core APIs and are denied without a
grant — silently, from the UI's point of view.

That produces a very misleading failure: `invoke('show_quiz')` succeeds (it is
a custom command), so the window *is* shown — but shown empty, and the window
is transparent, so nothing is visible, while the event that would have built
the card never arrives. Every step reports success.

`desktop/tauri/capabilities/default.json` grants `core:event:default` and the
window permissions the UI needs. **If you add a new core API call to the UI,
add its permission there too**, or it will fail the same silent way.

## The card is cut off / the Next button is unreachable

The window sizes itself to the card via a `ResizeObserver` on the wrapper.
Two things break this if you edit the layout:

- **Measuring at the wrong time.** Reading the height immediately after
  revealing content measures the *old* layout. That is why an observer is used
  instead of calling `fitWindow()` at hand-picked moments.
- **`.tpq-body` shrinking instead of growing.** It must be `flex: none` in
  `index.html`. With the inherited `flex: 1 1 auto` it shrinks inside the card
  rather than growing it, and content is laid out past the card's
  `overflow: hidden` bottom edge — visible as a button you cannot reach.

## There is a grey box / halo around the card

Something is painting into the transparent area. On a transparent window,
**every transparent pixel is still window area**, and anything drawn there
appears as a hard-edged rectangle instead of blending into the desktop.

The usual culprit is `box-shadow`: WebView2 composites its alpha against
nothing and renders a flat grey haze clipped to the window bounds. Effects
that bleed outside an element's box do not work here — that is why the card
has `box-shadow: none`.

## Changes to the UI do not show up

`desktop/ui/_preview.html` keeps its own copy of the window CSS. It has
drifted from `index.html` before, which meant a fix "passed" in preview
against markup the app never renders. If preview and app disagree, diff those
two files first.

## Build fails: `Access is denied (os error 5)`

The .exe is running and holds a lock on itself. Close the app (tray → Quit)
and rebuild.

## Other build failures

See [DESKTOP_BUILD.md](DESKTOP_BUILD.md) — in particular `linker link.exe not
found`, and the two non-obvious MSVC toolchain traps that go with it.
