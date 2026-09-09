# Cinematic Room — Realism Pass (shell surfaces, lighting rig, reflections)

Work log for the pass on `cinematic-scene.js` that took the studio room from
flat-shaded GLB surfaces to textured, lit, reflecting ones. Follows the
convention of `update.md` / `update2.md`: read this before touching the
lighting or the room traversal again, and append rather than rewrite.

Scope was limited to **room surfaces, the lighting rig, the environment map
and renderer settings**. Not touched: anything inside `<main class="stage">`,
every existing `script.js` function, and in `cinematic-scene.js` the camera
dolly (`frame()`, `lensPath` / `aimPath`, `updateEndPosition`), the CSS3D
screen mapping (`measureScreenPlane`, `placeScreenUI`, `wakeScreenUI`), the
power-on state machine (`pressPower`, `updatePowerOn`, `startPowerOff` and the
reverse-gesture handlers), `detailLaptop()` and the keycap atlas, and the
desk / chair / laptop geometry and positions in the model.

Nothing has been previewed in a browser in this session (the workflow rule
was: edit, save, stop). Section 5 lists what still has to be looked at.

---

## 0. What was found before editing

The task brief assumed flat grey planes and `createTable()` /
`createChair()` / `createLaptop()` builders. None of that exists any more:

- The room is **loaded from `models/studio-room.glb`**, not built from
  primitives. It already has real proportions and structure in metres:
  floor 5.2 × 5.6 m, ceiling at 2.85 m, all walls 0.12 m thick, a back wall
  in four pieces around a real window opening (reveals, jambs, head, sill,
  apron, mullion, rail, glass, and a sky card behind it), baseboards with
  caps on three walls, a ceiling fixture (canopy + emissive diffuser), an
  outlet plate. Desk top at 0.785 m, chair seat at ~0.53 m. So **item 1 of
  the brief (rebuild the room geometry) needed nothing** — the bones were
  already intentional; they just had no surface detail.
- The renderer already had `outputColorSpace = SRGBColorSpace`,
  `ACESFilmicToneMapping`, `antialias: true`, `useLegacyLights = false`
  (r160's spelling of physically-correct lights), `shadowMap.enabled` with
  `PCFSoftShadowMap`, and the post chain ends in an `OutputPass` so tone
  mapping survives the `EffectComposer`. **Item 4 of the brief was already
  done**; only the exposure was touched (see §3).
- The lighting rig already had a shadow-casting directional key shining in
  through the window, a `RectAreaLight` in the opening, a bounce panel, a
  hemisphere light and a weak ambient. What it lacked was a rim light, any
  top-down contact shadows, and an environment map (so metals and the
  floor's sheen had nothing to reflect).
- **The GLB ships with no textures at all**, and every shell mesh has the
  0..1-per-face box UVs an exporter writes — one tile would have stretched
  across the whole floor. The room meshes do carry `NORMAL` and
  `TEXCOORD_0` attributes; no node has a rotation or scale.

Material names in the GLB, for reference: `floor_oak`, `wall_paint`,
`wall_paint_shadowed` (left wall), `trim_white` (ceiling **and** every
baseboard / window trim / lamp canopy / outlet), `desk_walnut`,
`chair_wood`, `chair_fabric`, `steel_dark`, `rubber`, `laptop_alu`,
`laptop_alu_dark`, `keycap`, `key_well`, `power_key`, `power_glyph`,
`screen_off`, `bezel`, `glass_pale`, `sky`, `lamp_glow`.

## 1. Lighting rig (`LIGHTING` block, inside `init()`)

Existing lights kept as they were: `key` (directional, the only shadow caster
before this pass), `windowLight` (RectAreaLight in the opening), `bounce`.

- **Fill lowered.** `HemisphereLight` 0.32 → 0.18, `AmbientLight` 0.12 →
  0.04. The environment map (§2) now supplies most of the indirect light,
  and does so with a direction; the flat terms were only there to stop
  corners going black.
- **Rim added.** `DirectionalLight(0xd6e2f5, 0.45)` from the far left
  corner high up (`-2.3, 2.6, -2.7`) aimed at `0.2, 0.8, -1.6`. Cool,
  opposite the warm key, no shadow. Edges the chair back, the lid's top
  edge and the near corner of the desk off the greige wall.
- **Practical added.** `SpotLight(0xffd9b4, 3.2 cd, distance 0, 64°
  half-angle, penumbra 0.75, decay 2)` at `0, 2.74, 0.35`, just under the
  ceiling fixture's diffuser (which the model already draws lit). Second
  shadow caster: 1024² map, near 0.4, far 6.0, bias −0.0004, normalBias
  0.015. It reaches the desk from above and in front, so it is what lays
  the laptop's shadow on the desk and the chair's under itself — the
  contact shadows the window key can't give because it arrives from behind
  everything. Deliberately well under the daylight.

## 2. Environment map (`ENVIRONMENT` block, new)

`scene.environment` is a PMREM cubemap rendered once from a stand-in scene:
a `BoxGeometry` the room's size (from the `ROOM` constants) with six unlit
`MeshBasicMaterial` faces coloured as *radiance* (the GLB's own linear base
colours × how lit each face is), plus a `PlaneGeometry` at the window's
position at 3.2× white so it comes back as a highlight. Taken from
`ENV.eye = (0, 1.05, −2.0)`, just in front of the desk, with a 0.04 sigma
blur. Generator and stand-in meshes are disposed straight after.

`ENV.intensity = 0.42` is written to `envMapIntensity` on **every** material
in the room traversal (guarded with `'envMapIntensity' in material`). The
keycap material clones made later in `detailLaptop()` inherit it.

## 3. Renderer

`toneMappingExposure` 0.95 → 1.0. The surface maps below modulate the
shell's colours a few percent under white; this puts that back. Nothing
else in the `RENDERER` block changed.

## 4. Room surfaces (`SURFACES` block + the traversal in `onRoomLoaded`)

All canvas-drawn, no image files. Generation is synchronous, deterministic
(Mulberry32, fixed seeds), and placed **after** the `GLTFLoader().load()`
call so its ~0.3 s overlaps the download. Measured in Node with mocked
canvases: 340 ms for the full set, no NaNs, tiles wrap seamlessly.

Design rule: the colour maps only **modulate** (values a little under
white, seams darker), so the model's authored palette is untouched. The
normal maps are derived from a height field by central differences; the
green channel is unflipped because `CanvasTexture` is `flipY`.

- **Floor (`floor_oak`)** — `SURFACE.floor`: 768² canvas per 2 m tile, 17
  board strips across (~118 mm boards) running toward the window, 2 end
  joints per strip per tile at a random phase, per-strip tint / warmth /
  height lift, per-segment tint, grain from anisotropic value noise
  (96 × 3 cells, 3 octaves), pores (96 × 96, 2 octaves). Seams are a narrow
  groove with a wider bevel. Outputs `map` (sRGB), `normalMap` (relief 4.0)
  and `roughnessMap` (G channel: 0.60 mid, ±0.08 with the grain, 0.85 in
  the seams); `material.roughness` set to 1.0 so the map carries the value.
- **Walls (`wall_paint`, `wall_paint_shadowed`)** — `SURFACE.plaster`:
  512² per 1.2 m, broad trowel undulation (6 × 6, 4 octaves) under a fine
  roller stipple (160 × 160, 2 octaves). Colour 240–251 only; relief 0.7.
  Roughness 1.0, metalness 0.
- **Ceiling** — `trim_white` is shared with every piece of trim, so the
  `ceiling` node gets a **clone** (`ceiling_plaster`) dressed the same as
  the walls. Trim stays as authored.
- **UVs** — `projectShellUVs()` clones the geometry of the eight shell
  meshes (`floor`, `ceiling`, `wall_left`, `wall_right`, the four
  `wall_back_*` pieces) and writes box-projected UVs from **world**
  position in metres, so the back wall's four pieces share one unbroken
  plaster pattern and a tile is the same physical size on every surface.
  `texture.repeat = 1 / tile` does the scaling; all textures are
  `RepeatWrapping` with max anisotropy (the floor is seen at a grazing angle
  for the whole dolly).

Traversal changes: `SHELL` set added next to `NO_CAST`; the `floor_oak` case
now calls `dressFloor()`, the two `wall_paint*` cases call `dressPlaster()`,
the ceiling branch returns early after swapping its material. Shadow flags
and everything else in the switch (`sky`, `glass_pale`, `screen_off`,
`power_key` / `power_glyph`) are unchanged.

## 5. What is left / not verified

Not seen in a browser yet. In rough priority:

1. **Overall exposure and balance.** Fill was cut and env + rim + practical
   added by arithmetic, not by eye. First look should check the floor is
   not too dark (its map averages ~234 sRGB, i.e. ~17 % under the authored
   colour) and the window is still rolling off rather than posterising.
   Knobs: `toneMappingExposure`, `ENV.intensity`, the `fill` / `ambient`
   values, the `242` base in `drawFloor`.
2. **Practical strength and shadow quality.** 3.2 cd may read as a visible
   second light source or as nothing. Check for shadow acne on the desk
   top and the floor under the chair (`practical.shadow.bias` /
   `normalBias`), and that the 64° cone actually reaches the laptop
   (~54° off the lamp's axis).
3. **Normal-map sign.** If floorboard grooves look like ridges, flip the
   sign of `ny` in `normalMapFrom()` (or `normalScale.y`); the derivation
   assumes `CanvasTexture.flipY = true`.
4. **Floor board direction and scale.** Boards run along z (toward the
   window). If they should run across the room, swap the `u`/`v` roles in
   `drawFloor` (strips are indexed by `x`). Board width and tile size are
   in `SURFACE.floor`.
5. **Environment reflections on the panel.** `screen_off` now reflects the
   env at 0.42; check it doesn't fight the CSS3D UI fade at power-on. If
   it does, set `envMapIntensity = 0` in the `screen_off` case.
6. **Plaster visibility.** Relief 0.7 was chosen conservatively; it may be
   invisible at the wide shot. Raise `SURFACE.plaster.relief` if so.
7. **Load-time cost.** ~0.3 s of main-thread work at init (measured in
   Node). If it's felt, drop `SURFACE.floor.size` to 512 or cut an octave.
8. **Not done from the brief, by design:** no geometry was rebuilt (it was
   already right — §0); the floor stayed oak rather than becoming
   polished concrete, because the set is authored as oak and `ROOM`,
   `CLAUDE.md` and the lighting comments all assume it. A concrete floor
   would be a `drawFloor` replacement (noise + fine speckle, no boards) and
   a `roughness` around 0.4 — nothing else would need to change.
9. Phase 4 (dust / light shafts) is still open. The window opening,
   key-light direction and env window card are all aligned with it.

## 6. Files

- `cinematic-scene.js` — all changes. New named things: `rim`, `practical`,
  `ENV`, `buildEnvironment()`, `SURFACE`, `surfaces`, `makeRandom()`,
  `makeNoise()`, `fbm()`, `softEdge()`, `canvasFrom()`, `normalMapFrom()`,
  `textureFrom()`, `drawFloor()`, `drawPlaster()`, `dressFloor()`,
  `dressPlaster()`, `projectShellUVs()`, `SHELL`.
- `room.md` — this file.
- No changes to `index.html`, `style.css`, `script.js` or the GLB.
