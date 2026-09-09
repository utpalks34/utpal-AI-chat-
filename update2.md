# Laptop Intro — Redesign Pass 2 (persistent laptop frame)

Follow-up to `update.md`. Scope was limited to `#introLayer` / its CSS / `initLaptopIntro()`.
Nothing inside `<main class="stage">` and no existing `script.js` function
(`renderTabs`, `renderRail`, `renderChips`, `renderHistory`, `renderMessages`,
`send`, `reset`, `wireComposer`, `init`) was touched.

## What was asked

1. Make the intro actually read as a real laptop (metal bezel, camera, visible
   screen frame, keyboard deck, drop shadow).
2. Kill the "zoom to full-bleed and fade the bezel out" behaviour. The laptop
   chrome must stay on screen permanently, with the chat UI living **inside**
   the inset screen area, scaled to fit.
3. Keep the existing `<700px` mobile fallback (plain "Tap to enter" card, then
   the normal unframed chat UI).

---

## 1. Markup (`index.html`) — inside `#introLayer` only

Added one element: `.li-bezel`, wrapping `.li-screen` inside `.li-lid`.
That gives a real three-layer stack — **lid (metal) → bezel (darker frame) →
screen** — instead of the screen being a bare hole punched in the lid.

Also reordered the screen's children so the stacking is explicit:
`.li-screen-stage-wrap` (the chat UI) sits at the bottom, then dim → radial →
scanline → glare on top of it.

## 2. Styling (`style.css`) — the `/* ===== LAPTOP INTRO ===== */` block only

Rewrote most of the section. No rule outside that block was edited.

- **Device**: `.li-laptop` is `min(88vw, 1100px, 122vh)` wide, centered. Lid
  `aspect-ratio:16/9.3`, plus hinge and base ⇒ roughly 16:10 overall.
- **Lid**: three-stop metallic gradient (`#3f423e → #2c2f2b → #1c1e1c`),
  18px top corners, `inset 0 1px 0 rgba(255,255,255,.08)` top-edge highlight
  plus a `::before` specular line across the top edge.
- **Camera**: 6px dot with a highlight, centered in the metal strip directly
  above the bezel.
- **Bezel (the important one)**: `.li-bezel` is inset inside the lid and
  carries `padding: clamp(16px,1.8%,22px)`, so there is a **16–22px visible
  frame on all four sides at every size, before and after power-on**. It uses
  the same metal tone as the lid but darker (`#2b2e2b → #101210`), with a 1px
  black outline and its own inner highlight.
- **Screen**: fills the bezel's padding box, `#050505`, `overflow:hidden`,
  inset shadow for depth. Diagonal glass-reflection gradient overlay
  (`.li-screen-glare`) when off; a trace of it (`opacity:.32`) stays once the
  screen is live so it still reads as glass.
- **Base / keyboard deck**: `aspect-ratio:16/1.18`, `106%` width so it
  overhangs the lid like a real base, four-stop gradient (light deck → dark
  front edge), rounded only at the bottom, tucked directly under a thin dark
  `.li-hinge` bar. Three faint horizontal keyboard rows and a ~18%-wide
  trackpad outline.
- **Drop shadow**: blurred elliptical `::after` under the whole device so it
  rests on a surface.
- **Power button**: accent green on the lower lid bezel/chin, slow pulse. On
  power-on it transitions into a small steady green power LED
  (`.li-power-led`) rather than disappearing.
- Mobile fallback rules (`@media (max-width:699px)`) unchanged.

## 3. Behaviour (`script.js`) — `initLaptopIntro()` only

The final `DOMContentLoaded` line is unchanged from `update.md`
(`init(); initLaptopIntro();`).

**Removed**: the old full-bleed zoom (snap `.stage` into the screen rect, then
transition it back to identity while `#introLayer` fades out and is removed).
On desktop `#introLayer` is now never removed.

**Power-on sequence** (unchanged staging, confined to the screen area):
`dim pulse 150ms → scanline flash 150ms → radial glow 250ms + power LED`, then
the chat UI fades and scales `.92 → 1` (320ms, `transform-origin:center`)
inside the screen.

**New `fitStage()`** — replaces the old "stage = viewport size, letterboxed":

```
scale = min(0.8, screenRect.width / 1024)
stage layout size = screenRect / scale
wrap transform = translate(...) scale(scale)
```

So the chat UI is laid out at 1/scale of the inset screen rect and scaled back
down — it fills the screen area exactly (no black bars), is never laid out
narrower than 1024px, and is never scaled below what fits. Plain CSS
`transform: scale()`, no `zoom`, no overflow tricks.

**New `unframeStage()` / `onResize()`** — if the viewport later drops under
700px the CSS hides the laptop, which would hide the chat UI with it, so the
handler moves `#stage` back to `<body>`, strips its inline styles and removes
`#introLayer`, leaving the plain mobile layout.

---

## 4. Verified in Chrome (local static server, port 8791)

- Screen-off state renders as a laptop: metal lid, camera dot, thick visible
  bezel frame, chin + pulsing green power button, hinge, keyboard deck with
  row lines and trackpad, ground shadow.
- Power-on runs the four stages and **the lid, bezel and base stay in place** —
  no zoom to full-bleed, no bezel fade.
- Chat UI sits fully inside the screen with the frame visible around it, and
  measures exactly equal to the screen rect (no overflow past the frame).
- Interaction inside the scaled content all works:
  - typed "what is his stack" + Enter → answer rendered
  - "Projects" suggestion chip → answer rendered
  - scrolling the message list
  - clicking a History item → that conversation loaded
  - `document.elementFromPoint()` at the send button's center returns
    `sendBtn`, confirming hit-testing is correct under the transform
- No console errors.
- Mobile fallback at 390px: laptop hidden, "Tap to enter" card shown, tap
  reveals the normal full-width unframed chat UI. Confirmed afterwards that
  `#introLayer` is gone and `#stage` has **no** `style` attribute and is back
  under `<body>`.
- Intermediate width (760px): laptop still renders correctly and powers on with
  the frame intact.
- Underlying chatbot behaviour unchanged — no existing function was modified.

## 5. Known gap / not yet verified

- **`unframeStage()` on a live window resize is untested.** I tried to exercise
  it by shrinking a test `<iframe>` from 760px to 500px; the intro layer was
  not removed. Investigating that, I confirmed the cause is the **test
  harness, not the code**: resizing an `<iframe>` element from the parent
  document does **not** dispatch a `resize` event to the iframe's own
  `window` (measured `fired: 0` with an explicit listener while
  `innerWidth` had already changed to 640). A real browser window resize does
  fire it, so the handler should run — but that has not been proven yet
  because the Chrome `resize_window` tool had no effect on the maximized
  window in this session.
  - If it needs to be made bulletproof regardless of the resize event, the fix
    is to drive the unframe off
    `matchMedia('(max-width:699px)')`'s `change` event (which matches the CSS
    breakpoint exactly) instead of / in addition to `window.onresize`.
  - Note this only affects someone who resizes their browser *down into phone
    width mid-session*; first-load at any width is correct on both paths.

## 6. Cleanup / state

- A local `python -m http.server 8791` was started for testing and is still
  running; it should be stopped.
- Two Chrome test tabs were left open (one plain page, one iframe harness).
- No test files were added to the repo.
- Nothing has been committed — `index.html`, `style.css`, `script.js` and this
  file are working-tree changes only.

---

# Cinematic Intro — Pass 3 (chat UI on the 3D laptop's screen, CSS3D)

Correction to the previous pass. The standalone `#laptop-frame` CSS mockup
(bezel + keyboard silhouette) that the Three.js canvas dissolved into was a
second, disconnected laptop. Removed; the chat UI now lives on the screen mesh
of the laptop already sitting on the desk in the room. Nothing inside
`<main class="stage">` and no existing `script.js` function was touched —
`script.js` is back at its committed version (`initCineHandoff` /
`initScreenFit` and their CSS are gone; it knows nothing about the intro).

## 1. Markup (`index.html`)

- `#laptop-frame` / `.lf-*` / `#laptop-screen` / `#lf-fit` removed.
- New `#cineUI > #screenUI > #screenUIFit > main.stage`. `#cineUI` is the
  element handed to the CSS3DRenderer; `#screenUI` is the CSS3DObject;
  `#screenUIFit` is the scale wrapper. The module moves `#screenUI` into the
  renderer's camera element on the first frame.

## 2. Styling (`style.css`)

- Cut the `CINEMATIC HANDOFF`, `CHAT UI REVEAL`, `LAPTOP FRAME` and
  `SCREEN FIT` blocks (all belonged to the removed direction).
- New trailing `SCREEN UI (CSS3D)` block: `#cineUI` fixed full-viewport at
  z 10002, `pointer-events:none`; `#screenUI` 1280×800 default, opacity 0 →
  `.is-on` opacity 1 over 650ms; `#screenUIFit` 1391×870 at
  `transform:scale(.92)`; `#screenUIFit > .stage{width:100%;height:100%}`.

## 3. Behaviour (`cinematic-scene.js`)

- Imports `CSS3DRenderer` / `CSS3DObject` from `three/addons/renderers/`.
- Second renderer (`css3d`) on `#cineUI`, same size as the canvas, rendered
  after the WebGL frame every frame from the same camera, into its own
  `uiScene` (so it doesn't walk the room's node tree).
- `placeScreenUI()` — run at model load and again at the press — sizes
  `#screenUI` to `SCREEN_UI.pixelsAcross` × measured aspect, sizes/scales
  `#screenUIFit` by `SCREEN_UI.uiScale`, and sets the object's position /
  quaternion / scale from `screenPlane` (the front face measured off the
  `screen` mesh by `measureScreenPlane()`, which is now also called at load).
- Power-on keeps the same 1.15s push toward the panel. At `SCREEN_UI.wake`
  (0.30s) `wakeScreenUI()` adds `.is-on` and flips the element's inline
  `pointer-events` to `auto`. `SCREEN.lit` / `SCREEN.flash` dropped to
  0.18 / 0.45 so the WebGL panel is only a faint backlight under the DOM UI.
- `FIT.box` and `frameScreenBox()` removed; `updateScreenViewPosition()` is
  the fill path only (`FIT.fill` 0.985).
- `retire()` / `teardown()` removed — the scene is never torn down. Instead
  the loop parks (`PARK_AFTER` = move + 1s): when parked it skips all work
  unless `needsRender` was raised (resize, placement).

## 4. Not verified

Per the workflow rule for this pass nothing was opened in a browser. Things to
check by eye: that the CSS3D plane registers on the WebGL panel through the
whole push (both renderers use the one camera, so any drift would be a
`measureScreenPlane` issue), the legibility of `uiScale` 0.92 at the final
distance, and the phone layout — below 900px the chat UI still lives on the
panel (no mobile gate exists yet), and `.history-panel`'s `position:fixed`
will resolve against the transformed wrapper there.
