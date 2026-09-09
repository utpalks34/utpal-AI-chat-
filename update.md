# Laptop Power-On Intro — Status

## What was asked
Add a cosmetic "laptop power-on" intro overlay in front of the existing chatbot (index.html, style.css, script.js), without touching, renaming, or restyling anything in the existing chat UI. Pure HTML/CSS/JS, no frameworks/assets.

## What's done

### 1. Markup (index.html)
- Added `<div id="introLayer">...</div>` immediately before `<main class="stage">`.
- Added `id="stage"` to the existing `<main class="stage">` tag — the one allowed tweak per the spec. No other existing element/class/id was touched.
- `#introLayer` contains:
  - `.li-laptop` → `.li-lid` (bezel) → `.li-screen` (with `.li-screen-glare` overlay) and `.li-power` (⏻ button), plus `.li-base` (keyboard deck) as a sibling.
  - `.li-mobile-card` → `#liPowerBtnMobile` + "Tap to enter" label, for the <700px fallback.

### 2. Styling (style.css)
- All new rules added in a new `/* ===== LAPTOP INTRO ===== */` section at the very end of the file. No existing rule/selector was edited.
- Laptop bezel/screen/base built with plain CSS (gradients, border-radius, box-shadow) — no images.
- Screen-off state: `#050505` background + diagonal glare gradient overlay (`.li-screen-glare`).
- Power button uses the ⏻ glyph, `var(--accent)`, and a looping pulse (`liPowerPulse` keyframes on `box-shadow`).
- Power-on flicker via `liFlicker` keyframes (`steps(1,end)`, ~520ms) applied as a `.li-flicker` class.
- `#introLayer` background reuses the same gradient/color values as `.bg-radial`/body (not a new distinct background).
- Mobile fallback: `@media (max-width:699px)` hides `.li-laptop` and shows `.li-mobile-card`.

### 3. Behavior (script.js)
- Added one new function, `initLaptopIntro()`, inside the existing IIFE. No existing function (`init`, `render*`, `send`, `reset`, `wireComposer`, etc.) was modified.
- The **only** change to existing code is the final line, which now calls both functions:
  `document.addEventListener('DOMContentLoaded', () => { init(); initLaptopIntro(); });`
  (previously `document.addEventListener('DOMContentLoaded', init);`)
- Desktop sequence: capture the screen rect → flicker → snap the real `.stage` into a scaled/translated transform that exactly fills that rect (instant, live miniature preview) → after a short forced reflow, transition `.stage`'s transform back to identity while `#introLayer` fades its opacity to 0 (~850ms) → on transition end (or a timeout fallback), remove `#introLayer` and `stage.removeAttribute('style')` so `.stage` is back to a pixel-identical default state (no leftover inline style at all, not even an empty one).
- Mobile sequence: flicker the card → fade `#introLayer` opacity to 0 → remove it. `.stage` is never touched on mobile since it was never transformed.

### 4. Testing done so far
- Spun up a local static server and drove it with the Chrome automation tool.
- Verified on a first fresh load: laptop mockup renders correctly, clicking the power button runs flicker → zoom → reveal, and lands on a fully normal, fully interactive chat UI (tabs, rail, chips, history panel all rendered and clickable).
- Verified `#stage` cleanup: after intro finishes, `#introLayer` is removed from the DOM and `#stage` has no `style` attribute at all (confirmed via `hasAttribute('style') === false`).

### 5. Bug found and fixed during testing
- The zoom animation originally used a double `requestAnimationFrame` to force a style flush before starting the CSS transition (standard technique to make the "from" state paint before animating to the "to" state).
- Discovered this hangs indefinitely if the tab is not visible (`document.hidden === true`) — Chrome pauses `requestAnimationFrame` entirely for hidden/background tabs, so the intro would freeze at the "snapped small" mid-state and never zoom/clean up.
- Fixed by replacing the double `requestAnimationFrame` with a single short `setTimeout(fn, 30)`, which still forces the needed style flush but isn't paused by tab visibility. This is more robust for real users too (e.g., if a user alt-tabs right after clicking power).

## What's left / not yet verified

- **Re-verify the desktop flow end-to-end after the `setTimeout` fix.** The fix was just applied; the follow-up test to confirm the animation now completes and `#introLayer`/`#stage` clean up correctly was interrupted before it ran.
- **Test the mobile fallback (<700px width) flow** — flicker + fade sequence has not been exercised in the browser yet.
- **Re-confirm full interactivity after intro on both paths**: sending a chat message, switching tabs, opening/closing the mobile history drawer, clearing chat — to make sure nothing about `.stage` behaves differently post-intro vs. a plain reload with the intro removed.
- **Spot-check a couple of intermediate viewport widths** (e.g. right around the 700px breakpoint, and a very short viewport) to make sure the laptop mockup and the scale-into-screen-rect math hold up (the scaleX/scaleY mapping assumes `.stage` is exactly `100vw × 100vh`, which is true per the existing CSS, but worth confirming visually).
- **Clean up test artifacts**: a local `python -m http.server` was started on port 8791 for browser testing — should be stopped if not already, and no test files were left in the repo.
- No changes have been committed to git yet — everything above is in the working tree only.
