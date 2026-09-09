# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page portfolio for Utpal Kant Sharma, presented as a fake AI chatbot ("Utpal's AI Assistant") displayed inside a photographic laptop mockup, with a Three.js studio-room intro in front of it. **Static site: no npm, no bundler, no build step, no tests.** Everything is `index.html` + `style.css` + `script.js` + `cinematic-scene.js` + `models/studio-room.glb`.

## Running it

ES modules and the GLB fetch mean `file://` will not work — serve over HTTP:

```
python -m http.server 8791
```

then open `http://localhost:8791/`. Three.js is pulled from unpkg via the `<script type="importmap">` block in `index.html` (pinned to 0.160.0); `cinematic-scene.js` resolves `three` and `three/addons/` through it. Nothing is installed locally.

## Architecture

### Layer stack (z-order, front to back)
1. `#cineIntro` (z 10001) — Three.js canvas, full viewport. Owned solely by `cinematic-scene.js`.
2. `#introLayer` (z 9999) — the laptop photo (`laptop-mockup.jpg`) plus power button; owned by `initLaptopIntro()` in `script.js`.
3. `<main class="stage">` — the actual chat UI, moved *inside* `#liScreenStageWrap` on desktop so it renders on the laptop's screen.

### `script.js` — one IIFE, two halves
The **chat app** (`KB`, `HISTORY`, `state`, `match`, `send`, `startTyping`, the `render*` functions, `wireComposer`, `wireMobileDrawer`, `init`). There is no backend and no LLM: `match()` regex-matches the query against a handful of `KB` keys and `startTyping()` types the canned reply out character by character. All portfolio content (projects, stack, experience, education, contact) lives in the `KB` object at the top of the file — edit content there, not in the DOM.

The **intro/mockup machinery** (`initLaptopIntro`, `initTypingZoom`), deliberately additive: it was written to leave every existing chat function untouched. The only shared line is the bottom-of-file `DOMContentLoaded` handler calling `init(); initLaptopIntro(); initTypingZoom();`.

### The screen-mapping homography (the tricky part)
The laptop in the photo is angled, so its display is a trapezoid, not a rectangle. `initLaptopIntro()` therefore:
- lays `#stage` out at `screenRect / scale` (capped at `MAX_SCALE = 0.8`, never narrower than `MIN_LAYOUT_W = 1024`), then
- computes a projective transform (`adj3` / `mul3` / `mulv3` / `basisTo` / `homography`) mapping that rectangle onto `SCREEN_QUAD` — four corner fractions measured off the 1536×1024 source image — and applies it as a **column-major `matrix3d`** on `#liScreenStageWrap`.

If `laptop-mockup.jpg` is ever replaced, `SCREEN_QUAD` and the `transform-origin` on `#liPhoto` in the TYPING ZOOM CSS block must be re-measured together.

`initTypingZoom()` scales the whole `#liPhoto` wrapper (not the stage) when the composer is focused, so the mapped stage rides along and stays hit-testable.

### Mobile fallback
`MOBILE_BP = 700` in JS must stay in sync with the `@media (max-width:699px)` rules in CSS — both the mobile card path and `unframeStage()`, which moves `#stage` back under `<body>` and strips its inline styles when the viewport drops below the breakpoint mid-session.

### `cinematic-scene.js`
Self-contained ES module — imports nothing from and exports nothing to `script.js`. Loads the whole set from `models/studio-room.glb` (real-world metres, floor at y=0, back wall at z=-2.92); the module owns only camera, lighting rig and the render loop. Room landmarks live in the `ROOM` constant and the establishing camera in `SHOT` — aim things at those rather than hardcoding numbers. Named nodes pulled out of the GLB (`desk_top`, `chair_seat_frame`, `laptop_base`, `screen`, `power_button`) land in `props`. The GLB ships with no textures, so `detailLaptop()` (called from the load callback) draws a procedural keycap atlas with Windows legends, re-projects each `key_<row>_<col>` mesh's UVs into its tile (cloning the shared geometry first), and clones darker/glossier materials onto the trackpad, hinge and bezel. It never touches `power_button` or `screen`, whose emissive channels Phase 5 animates.

Built in phases; the file carries `===== PHASE N =====` markers where the remaining work slots in. Phases 1–2 (renderer, lighting, room) are done; Phase 3 (scroll-driven camera dolly toward `props.dollyTarget`) goes in the `frame()` loop, Phase 4+ (post-processing, handoff to the laptop UI reveal) at the bottom.

## Conventions

- CSS is one file, organised in `/* ===== SECTION ===== */` blocks appended in order (`LAPTOP INTRO`, `TYPING ZOOM`, `CINEMATIC 3D INTRO`). New feature work goes in a new trailing block rather than editing earlier rules — that separation is why the chat UI has stayed stable across three intro rewrites.
- Colour tokens are the four `:root` custom properties in `style.css`; `--accent` (`#8ef06a`) is the green used everywhere.
- Comments in this codebase explain *why* a value or technique was chosen (e.g. why `setTimeout(30)` replaced double-`requestAnimationFrame`, why `setSize(w,h,false)`). Match that register.
- `update.md` and `update2.md` are chronological work logs for the intro rewrites, including bugs found and known gaps. Read them before touching `initLaptopIntro()`; append rather than rewrite if you do another pass.
