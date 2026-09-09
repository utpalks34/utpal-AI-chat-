/* =========================================================================
   CINEMATIC 3D INTRO — PHASE 6: the chat UI on the laptop's screen
   =========================================================================
   Replaces the old CSS-drawn #roomScene (flat wall/floor/table/chair) with a
   real WebGL environment. Deliberately kept in its own module: nothing here
   imports from, exports to, or otherwise touches script.js.

   The room is no longer assembled from primitives. `models/studio-room.glb`
   carries the whole set — floor, ceiling, walls with baseboards, the trimmed
   window, the walnut desk on black steel legs, the wooden chair with its
   fabric seat, and the laptop down to its keycaps — modelled at real-world
   scale in metres, with the floor at y=0 and the back wall at z=-2.92. All
   this module owns is the camera, the lighting rig and the render loop.

   What exists now: renderer, the daylight rig, the loaded room, and a camera
   that walks from the wide establishing shot to a close-up of the laptop's
   key well as you scroll — with the room behind it falling out of focus on
   the way in. The scroll it reads is #cineIntro's own, not the document's;
   see the CINEMATIC SCROLL TRACK block in style.css for why. Once that walk
   is over and the lens is down on the deck, the power button arms itself,
   picks up a slow glow and takes a click. That click is the last beat: the
   camera comes off the scroll and pushes the rest of the way in until the
   panel fills the frame, and the panel wakes as it arrives.

   Waking is not a crossfade to another page. The chat UI (`#screenUI`, the
   wrapper around <main class="stage">) is a CSS3DObject: a second renderer,
   CSS3DRenderer, is given the same camera every frame and draws into a DOM
   layer laid exactly over the WebGL canvas, and the object is placed,
   turned and scaled to sit on the panel's measured front face — so the
   real, live interface is a surface in the room, seen in the same
   perspective as everything else, and the power-on is one opacity fade
   from the dark panel to it. The room, the desk and the laptop stay in the
   scene for the whole session; once the move has settled the loop only
   redraws when something changes.

   Loaded as <script type="module">, resolving "three" through the import map
   in index.html, so the site stays a plain static site with no build step.
   ========================================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const MODEL_URL = 'models/studio-room.glb';

/* Landmarks read straight off the model, in metres. Everything the camera and
   the lights are aimed at is expressed against these rather than as loose
   numbers, so a change to the room only has to be made in one place. */
const ROOM = {
  backWallZ: -2.92,
  ceilingY: 2.85,
  wallLeftX: -2.60,
  wallRightX: 2.60,
  floorFrontZ: 2.80,
  windowCentre: new THREE.Vector3(0, 1.55, -2.89),   // centre of the glass
  windowWidth: 2.10,
  windowHeight: 1.06,
  deskTopY: 0.785
};

/* The establishing shot — where the scroll starts. Lens at seated eye height
   a little in front of the chair, level and near the room's centre line, so
   the window sits square in the back wall and the desk reads straight on with
   the left wall just raking in at the frame edge. */
const SHOT = {
  fov: 46,
  position: new THREE.Vector3(0.05, 1.25, 0.55),
  target: new THREE.Vector3(-0.28, 0.80, -2.92)
};

/* ...and where it ends: leaning in over the front edge of the desk, looking
   down at the key well with the power button in the right half of the frame.

   Only the aim point and the shape of the shot are constants here. The
   camera's own position is derived from them (`updateEndPosition`), because a
   fixed position would frame correctly in one window and crop the keyboard in
   a narrower one. `frameWidth` is the promise being kept instead: that much
   desk across the frame, whatever the aspect ratio turns out to be.

   `target` is a fallback — it is re-measured off the model once it loads. */
const END = {
  target: new THREE.Vector3(0.014, 0.803, -2.326),
  pitch: THREE.MathUtils.degToRad(48),   // how far down the lens is tipped
  frameWidth: 0.45,                      // metres of desk across the frame
  minDistance: 0.26,                     // never closer than this to the deck
  maxDistance: 0.80                      // portrait windows pull back to here
};

/* Aim between the key well's centre and the power button. The well's centre
   alone pushes the button out to the frame edge; the button alone throws the
   keyboard off to the left. A little over a quarter of the way across holds
   both. */
const POWER_BIAS = 0.28;

/* How hard the camera is dragged toward the scroll position, per second. High
   enough to feel attached to the wheel, low enough to smooth out the coarse
   steps a mouse wheel actually delivers. */
const SCROLL_DAMPING = 7.5;

/* Depth of field. `start` is the point in the move where the room begins to
   soften — the wide shot stays sharp end to end, because a blurred
   establishing frame just reads as a broken render. */
const DOF = {
  start: 0.30,
  aperture: 0.035,   // peak; ramps up from zero across `start`..1
  maxblur: 0.012     // blur radius ceiling, in UV units
};

/* When the power button wakes up. Measured against the camera's own position
   along the dolly — the eased `t` — and not against the raw scroll, because
   what makes the button reachable is the lens actually being down on the
   deck, and the damping leaves those two some way apart whenever the
   scrollbar has been flung rather than rolled. Undoing the ease, `full` lands
   at about 94% of the scroll track and `begin` at about 80%.

   The gap between them is not dead space: the glow ramps across it, so the
   cap is visibly coming up as the shot settles and is at full strength on the
   frame it becomes clickable. Clicks before `full` are ignored outright —
   a button that answers mid-dolly reads as a mis-click, not as a feature. */
const ARM = {
  begin: 0.90,
  full: 0.99
};

/* The idle cue. Both of the cap's materials are already wired with an
   --accent emissive sitting at zero intensity (see the traversal below), so
   all of this moves is one number.

   `base`..`peak` is a shallow breath rather than a blink: it has to read as
   "this is live" without turning a keycap into the brightest thing in a
   daylit photographic room. `hover` is the flat, brighter value held under
   the pointer, and `press` the punch on the click itself, decaying back to
   `hover` — the machine stays lit once it is on. */
const GLOW = {
  base: 0.30,
  peak: 0.85,
  hover: 1.35,
  press: 2.60,
  breathHz: 0.42,      // one full breath every ~2.4s
  pressDecay: 3.2      // units per second, back down to `hover` after a press
};

/* THE POWER-ON. The press takes the camera off the scroll and pushes it the
   rest of the way in, to the one shot the whole dolly has been walking
   toward: the panel square to the lens, filling the frame (see FIT below).
   Short on purpose —
   this is a machine answering a button, not another beat to sit through, and
   deliberately not another scroll-gated step.

   `move` is the camera. `SCREEN.ramp` below is the panel coming up, and the
   two run together rather than one after the other, so the light arrives
   while the lens is still travelling. */
const POWER_ON = {
  move: 1.15      // seconds, deck close-up → screen filling the frame
};

/* ...AND THE WAY BACK OUT. The power-on is not a one-way door: scrolling up
   off the lit panel runs the same move backwards — the UI dissolves, the
   backlight falls to black, the lens retreats to exactly the frame the press
   was taken on — and only then does the scroll get the camera back, so the
   dolly reverses out to the wide room shot from where it left off rather
   than cutting to it.

   A gesture rather than a scroll position, because there is no scroll
   position to read while the camera is off the track: the wheel is
   accumulated until it clears one of these, so a trackpad's idle jitter (or
   the tail of the flick that finished the dolly) cannot dismiss the screen
   that just came on. `idleReset` throws away a part-built gesture once the
   input goes quiet, so two unrelated nudges a second apart don't add up. */
const REVERSE = {
  wheel: 40,        // px of upward wheel travel before the power-off starts
  touch: 28,        // px of downward finger travel, same thing
  idleReset: 320    // ms of quiet that clears a part-built gesture
};

/* Where the panel lands at the end of the power-on: filling the viewport.
   `fill` scales the distance that would just contain the whole panel on the
   tighter axis. A hair under 1 pushes the panel's edge a fraction past the
   frame edge, so no sliver of bezel shows along it, while cropping well
   under 1% of the chat UI — which is inside the stage's own padding. On the
   looser axis (a 16:9 window around a 16:10 panel) a strip of bezel and
   room stays visible either side, and that is the point: this is still the
   laptop on the desk, not a page. */
const FIT = {
  fill: 0.985
};

/* The chat UI on the panel. `pixelsAcross` is the panel's virtual
   resolution — the CSS pixel width the CSS3DObject's element is given, then
   scaled so that many pixels span the panel's measured width in metres.
   `uiScale` is the legibility knob for the layout inside it: the chat UI is
   laid out at pixelsAcross / uiScale wide (≈1390px at these values — wide
   enough that the rail, the chat column and the history panel sit side by
   side without crowding) and drawn down to fit by a transform: scale() on
   the wrapper inside the object, so type lands at about its designed size
   once the panel fills a laptop-width window. Lower it for more room and
   smaller type, raise it for the reverse; the CSS defaults in the SCREEN UI
   block of style.css are these same numbers and are overwritten from here.

   `wake` is when the UI starts fading in, in seconds after the press — after
   the backlight strikes, before the lens has arrived — and `fade` the fade's
   length, which is also the transition in that CSS block; the two have to
   move together. */
const SCREEN_UI = {
  pixelsAcross: 1280,
  uiScale: 0.92,
  wake: 0.30,
  fade: 650
};

/* Waking the panel. Not a lamp switched on at a constant value: `flash` is
   the kick a backlight gives as it strikes, `lit` the value it falls back to
   and holds. Both are kept faint — the WebGL panel is only the dark glass
   under the chat UI, which is a DOM layer laid over it (see SCREEN_UI), so
   anything brighter than a backlight coming up would double with the UI's
   own ground during the fade. The colour is an LCD's own white — a touch
   bluer than the daylight in the room. */
const SCREEN = {
  colour: 0xdfe7ff,
  lit: 0.18,
  flash: 0.45,
  ramp: 0.55,       // seconds from black to the resting value
  flashSpan: 0.5    // the kick occupies the first half of that ramp
};

const canvas = document.getElementById('cineCanvas');
const scroller = document.getElementById('cineIntro');
let scrollCue = document.getElementById('cineScrollCue');

/* The DOM side of the screen: the layer the CSS3DRenderer draws into, the
   element that becomes the CSS3DObject, and the scale wrapper inside it that
   holds <main class="stage">. All three are in index.html. */
const uiLayer = document.getElementById('cineUI');
const uiElement = document.getElementById('screenUI');
const uiFit = document.getElementById('screenUIFit');

if (canvas) init();

function init() {
  /* ---------------------------------------------------------------------
     RENDERER
     ACES tonemapping plus sRGB output is what rolls the window off to white
     instead of clipping it, and keeps the warm greige walls from going chalky.
     --------------------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });

  // Cap at 2x: past that the extra fill rate buys nothing visible here.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  /* A touch over unity: the surface maps below modulate the shell's colours
     a few percent under white, and this puts that back. */
  renderer.toneMappingExposure = 1.0;

  /* Physically correct lighting. In r160 this is the default and is spelled
     `useLegacyLights = false` (the old `physicallyCorrectLights` flag was
     removed in r155); set explicitly so the intent survives a version bump. */
  renderer.useLegacyLights = false;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // RectAreaLight needs its BRDF lookup tables initialised before first use.
  RectAreaLightUniformsLib.init();

  /* ---------------------------------------------------------------------
     SCENE
     No fog: the camera is inside a closed room, so fog would only wash the
     back wall out. The background is visible for the frame before the model
     lands, so it is set to a dark neutral rather than to black.
     --------------------------------------------------------------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151513);

  /* ---------------------------------------------------------------------
     CAMERA — establishing shot
     A ~46° lens: wide enough to hold the whole window plus a rake of the left
     wall, tight enough that the desk doesn't stretch at the frame edges the
     way a true wide-angle would. The focal length stays put for the whole
     move: this is a dolly, not a zoom, and animating the fov alongside it
     would turn it into a Vertigo shot.
     --------------------------------------------------------------------- */
  const camera = new THREE.PerspectiveCamera(
    SHOT.fov,
    window.innerWidth / window.innerHeight,
    0.05,
    60
  );
  camera.position.copy(SHOT.position);

  // Where the lens is pointed, moved along its own path by the scroll.
  const cameraTarget = SHOT.target.clone();
  camera.lookAt(cameraTarget);

  /* ---------------------------------------------------------------------
     THE SCREEN UI — the second renderer
     The chat UI cannot be a texture: it has to stay a live document that
     takes focus, typing and clicks. So it is drawn by a CSS3DRenderer — a
     DOM layer the size of the canvas, laid over it (#cineUI in style.css),
     handed the same camera every frame — which turns each CSS3DObject's
     world matrix into a matrix3d on its element, under a perspective() that
     matches the lens. The object here is #screenUI, and placeScreenUI()
     puts it on the panel's measured front face once the model is in.

     Its own scene rather than the room's: render() walks every child of
     whatever scene it is given looking for CSS3DObjects, and the room has a
     few hundred nodes to walk past for nothing.

     The layer is pointer-events:none, inherited by everything inside it, so
     the wheel and the power button's clicks reach the canvas underneath;
     the object's element alone is switched to auto when the UI wakes.
     CSS3DObject's constructor writes two inline styles on the element —
     pointer-events:auto and user-select:none — and both are undone here:
     the first until wake, the second for good, because the composer's text
     has to be selectable.
     --------------------------------------------------------------------- */
  const css3d = new CSS3DRenderer(uiLayer ? { element: uiLayer } : {});
  css3d.setSize(window.innerWidth, window.innerHeight);

  /* The renderer writes overflow:hidden on its layer, which clips — but it
     also makes the layer a scroll container, and a browser scrolls a scroll
     container to reveal whatever gets focus inside it. With a 3D-transformed
     subtree the layer's scrollable extent is whatever the projected planes
     sweep out, so focusing the composer could shove the whole picture over.
     `clip` clips the same and scrolls never; a browser without it ignores
     the assignment and keeps `hidden`, i.e. exactly what it had. */
  css3d.domElement.style.overflow = 'clip';
  if (!uiLayer) {
    // Older markup without the layer: make one, in the same place.
    css3d.domElement.id = 'cineUI';
    document.body.appendChild(css3d.domElement);
  }

  const uiScene = new THREE.Scene();
  const uiObject = uiElement ? new CSS3DObject(uiElement) : null;
  if (uiObject) {
    uiElement.style.pointerEvents = 'none';
    uiElement.style.userSelect = '';
    // Hidden outright (display:none, via the renderer) until the panel has
    // been measured and there is somewhere for it to be.
    uiObject.visible = false;
    uiScene.add(uiObject);
  }

  /* ---------------------------------------------------------------------
     LIGHTING — overcast daylight through the window, a lamp overhead
     A three-point rig wearing a room's clothes: the window is the key, the
     hemisphere, the bounce panel and the environment map (below) are the
     fill, and a cold directional from the far corner is the rim. The ceiling
     fixture sits above the frame in the establishing shot, but the model
     draws it lit, so it lights the room — quietly, as a practical.
     --------------------------------------------------------------------- */

  /* Key: the only shadow caster. It stands outside the back wall and shines
     in through the opening, so the wall itself masks it — the soft pool that
     lands on the floor is the window's own shape. Offset to camera-right of
     the opening so that pool falls to the left, and warm-neutral rather than
     pure white so the oak floor keeps its colour. */
  const key = new THREE.DirectionalLight(0xfff1dc, 1.15);
  key.position.set(2.40, 3.90, -7.20);
  key.target.position.set(-0.90, 0.30, -1.10);
  key.castShadow = true;

  /* The frustum has to contain the room and not much beyond it: too loose and
     the 2k map spreads thin, too tight and the desk's shadow clips. */
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4.5;
  key.shadow.camera.right = 4.5;
  key.shadow.camera.top = 4.5;
  key.shadow.camera.bottom = -4.5;
  key.shadow.camera.near = 1.5;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.0006;      // kills acne on the near-flat floor
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;          // PCFSoft blur width
  scene.add(key);
  scene.add(key.target);

  /* The softness is this: an emitter the size of the glass, sitting in the
     window opening and facing into the room. It is what actually lights the
     desk, the chair and the near half of the floor — diffuse, no falloff
     artefacts, and no shadows to fight the key's. */
  const windowLight = new THREE.RectAreaLight(
    0xf3f2ee,
    3.0,
    ROOM.windowWidth,
    ROOM.windowHeight
  );
  windowLight.position.set(
    ROOM.windowCentre.x,
    ROOM.windowCentre.y,
    ROOM.backWallZ + 0.06
  );
  windowLight.lookAt(0, 0.90, 0.40);
  scene.add(windowLight);

  /* A second, much weaker panel low and forward, standing in for the bounce
     off the floor that a path tracer would give for free. Without it the
     underside of the desk and the front of the chair go to mud. */
  const bounce = new THREE.RectAreaLight(0xffe4c8, 0.5, 4.0, 2.0);
  bounce.position.set(-0.60, 0.55, 0.60);
  bounce.lookAt(0.10, 0.80, -2.60);
  scene.add(bounce);

  /* Fill: cool sky from above, warm floor bounce from below. Both are lower
     than they were, because the environment map below now carries most of
     the indirect light — and carries it with a direction, so the underside
     of the desk stays darker than its top in a way no flat ambient term can
     manage. What is left here is just enough to keep the deepest corners
     from going to black. */
  const fill = new THREE.HemisphereLight(0xc8cfd8, 0x5a4331, 0.18);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xc3bdb2, 0.04);
  scene.add(ambient);

  /* Rim: a cool, weak directional from high in the far left corner, behind
     the furniture and opposite the warm key. It lays a thin cold edge along
     the chair back, the top of the lid and the near corner of the desk —
     the separation that keeps them from sinking into the greige wall when
     the daylight leaves both in the same half-tone. No shadow: a second set
     of hard-edged shadows would only argue with the window's. */
  const rim = new THREE.DirectionalLight(0xd6e2f5, 0.45);
  rim.position.set(-2.3, 2.6, -2.7);
  rim.target.position.set(0.2, 0.8, -1.6);
  scene.add(rim);
  scene.add(rim.target);

  /* Practical: the ceiling fixture. The model authors its diffuser lit (an
     emissive material), and a lamp that glows without lighting anything
     reads as a mistake once the surfaces around it have any texture to show
     it up. Kept well under the daylight — a warm top light, not a second
     key — but it is the rig's other shadow caster, and the one that does
     the close work: it hangs over the chair, so it reaches the desk from
     above and in front, and lays the laptop's own soft shadow down behind
     it on the walnut and the chair's under itself on the floor. Those are
     the contact shadows the window light cannot give, because it arrives
     from behind everything. Physically-correct units, so the intensity is
     candela and the inverse-square falloff over the drop does the rest. */
  const practical = new THREE.SpotLight(
    0xffd9b4,
    3.2,                               // candela
    0,                                 // no hard cutoff distance
    THREE.MathUtils.degToRad(64),      // half-angle; wide, it has a room to cover
    0.75,                              // penumbra — most of the cone is soft edge
    2                                  // inverse-square
  );
  practical.position.set(0.0, 2.74, 0.35);   // just under the diffuser
  practical.target.position.set(0.0, 0.0, -1.2);
  practical.castShadow = true;
  practical.shadow.mapSize.set(1024, 1024);
  practical.shadow.camera.near = 0.4;
  practical.shadow.camera.far = 6.0;
  practical.shadow.bias = -0.0004;
  practical.shadow.normalBias = 0.015;
  scene.add(practical);
  scene.add(practical.target);

  /* ---------------------------------------------------------------------
     ENVIRONMENT — what the glossy surfaces reflect
     Lights alone give a brushed metal or a waxed board nothing to mirror,
     which is why the laptop's aluminium and the floor's sheen looked painted
     on. This is a stand-in for the room itself, rendered once into a
     prefiltered cubemap: a box the room's size, each face at the shade it
     sits at under the window's light, with the window as a bright card in
     the right place on the back wall — so the lid picks up a soft highlight
     from the right direction, and nothing in the reflections contradicts
     the rig above. Flat-shaded boxes rather than a photographic HDRI,
     because the room is plain enough that a photograph of somewhere else
     would be the thing that looked wrong.
     --------------------------------------------------------------------- */
  const ENV = {
    intensity: 0.42,                          // envMapIntensity on every material; keeps reflections under the direct light
    eye: new THREE.Vector3(0, 1.05, -2.0)     // where the cubemap is taken from: just in front of the desk
  };

  scene.environment = buildEnvironment();

  function buildEnvironment() {
    const env = new THREE.Scene();

    /* The generator renders from the origin, so the room is shifted to put
       ENV.eye there rather than the camera being moved. */
    const world = new THREE.Group();
    world.position.copy(ENV.eye).negate();
    env.add(world);

    const width = ROOM.wallRightX - ROOM.wallLeftX;
    const depth = ROOM.floorFrontZ - ROOM.backWallZ;
    const height = ROOM.ceilingY;

    /* Radiance, not albedo: the model's own linear base colours, multiplied
       by roughly how lit each face is. Unlit materials, so what is drawn is
       exactly what is reflected. */
    const lit = (r, g, b, level) => new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(r * level, g * level, b * level),
      side: THREE.BackSide
    });
    const wall = [0.839, 0.831, 0.812];
    const trim = [0.937, 0.933, 0.925];
    const oak = [0.478, 0.353, 0.235];

    // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    const shell = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [
      lit(...wall, 0.30),   // right wall, in the light
      lit(...wall, 0.20),   // left wall, the shadowed one
      lit(...trim, 0.22),   // ceiling
      lit(...oak, 0.38),    // floor
      lit(...wall, 0.15),   // the wall behind the camera
      lit(...wall, 0.26)    // back wall
    ]);
    shell.position.set(
      (ROOM.wallLeftX + ROOM.wallRightX) / 2,
      height / 2,
      (ROOM.backWallZ + ROOM.floorFrontZ) / 2
    );
    world.add(shell);

    /* The window: well past 1, so it comes back as a highlight and not as a
       pale rectangle. */
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.windowWidth, ROOM.windowHeight),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(0.96, 0.97, 1.0).multiplyScalar(3.2)
      })
    );
    glow.position.set(ROOM.windowCentre.x, ROOM.windowCentre.y, ROOM.backWallZ + 0.02);
    world.add(glow);

    const pmrem = new THREE.PMREMGenerator(renderer);
    // A little blur: the window card has no business having crisp edges.
    const texture = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    env.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) [].concat(node.material).forEach((m) => m.dispose());
    });
    return texture;
  }

  /* ---------------------------------------------------------------------
     THE ROOM
     Loaded, not built. The traversal below is the only place the model is
     touched: it turns shadows on, tunes the handful of materials that need to
     behave differently from a plain PBR surface, and picks out by name the
     parts the camera path and the later phases animate.
     --------------------------------------------------------------------- */

  /* Everything outside the load callback reaches for, gathered in one place
     so the wiring is obvious. Populated once the model resolves — the render
     loop and the resize handler both run before then and must not depend on
     it, which is why every world-space anchor carries a measured-off-the-model
     fallback rather than starting null. */
  const props = {
    room: null,
    desk: null,
    chair: null,
    laptop: null,
    keyWell: null,
    screen: null,
    screenMaterial: null,
    powerButton: null,
    powerButtonMaterial: null,
    powerMaterials: [],
    powerHotspot: null,
    screenPos: new THREE.Vector3(-0.029, 0.923, -2.404),
    keyWellPos: new THREE.Vector3(-0.023, 0.803, -2.310),
    powerButtonPos: new THREE.Vector3(0.108, 0.805, -2.365)
  };

  new GLTFLoader().load(MODEL_URL, onRoomLoaded, undefined, onRoomFailed);

  /* ---------------------------------------------------------------------
     SURFACES — procedural detail for the room's shell
     The GLB ships with no images, so the floor, the walls and the ceiling
     arrive as one flat colour each, and a flat colour under a soft light
     bands: the wall behind the desk shows the tone-mapper's steps as
     contour lines. These are drawn here, once, into canvases — a colour map
     that only modulates the model's own colour (so the palette the set was
     authored in is untouched), a height field turned into a normal map so
     the surface actually catches the light, and for the floor a roughness
     map so the sheen varies board to board the way a waxed floor's does.
     Nothing busy: at the establishing shot none of this should be
     nameable, just felt as the difference between a render and a room.

     Seamless by construction — the noise is periodic and the boards fit the
     tile exactly — because the floor repeats its tile a dozen times and any
     seam would march across the frame as the camera dollies.

     Drawn synchronously, and deliberately placed after the model's fetch has
     been kicked off above: the whole set takes a third of a second or so,
     and this way that overlaps the download instead of adding to it. The
     load callback is the first thing that needs the result.
     --------------------------------------------------------------------- */
  const SURFACE = {
    floor: {
      size: 768,            // ~380px per metre: plenty for a floor the lens never lands on, at half the cost of 1024
      tile: 2.0,            // metres of floor per repeat
      boards: 17,           // strips across the tile → ~118mm boards
      joints: 2,            // end joints per strip per tile → ~1m boards
      relief: 4.0,          // normal-map strength; the seams are grooves, the grain barely there
      roughness: 0.60,      // the sheen's mid value; the map swings it ±0.08 with the grain
      seamRoughness: 0.85   // dust sits in the grooves
    },
    plaster: {
      size: 512,
      tile: 1.2,
      relief: 0.7           // a few degrees of tilt at most; paint hides more than it shows
    }
  };

  const surfaces = {
    floor: drawFloor(SURFACE.floor, makeRandom(0x0ac0f1)),
    plaster: drawPlaster(SURFACE.plaster, makeRandom(0x7a57e2))
  };

  /* Deterministic, so every load draws the same boards — a floor that
     rearranged itself between visits would be the kind of thing nobody
     could name but everybody would notice. Mulberry32. */
  function makeRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Periodic value noise: an `nx`×`ny` lattice of random values sampled with
     smooth interpolation, wrapping at the edges so the result tiles. u, v
     are fractions of the tile. */
  function makeNoise(nx, ny, random) {
    const lattice = new Float32Array(nx * ny);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    return (u, v) => {
      const gx = u * nx;
      const gy = v * ny;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const ix = x0 % nx;
      const iy = y0 % ny;
      const ix1 = (ix + 1) % nx;
      const iy1 = (iy + 1) % ny;
      const a = lattice[iy * nx + ix];
      const b = lattice[iy * nx + ix1];
      const c = lattice[iy1 * nx + ix];
      const d = lattice[iy1 * nx + ix1];
      const top = a + (b - a) * sx;
      const bottom = c + (d - c) * sx;
      return top + (bottom - top) * sy;
    };
  }

  /* Octaves of the above at doubling frequency and halving weight, back in
     0..1. Cells that differ per axis stretch the noise — that is what turns
     blobs into wood grain. */
  function fbm(random, cx, cy, octaves) {
    const layers = [];
    let total = 0;
    for (let o = 0, amp = 1; o < octaves; o++, amp *= 0.5) {
      layers.push({ noise: makeNoise(cx << o, cy << o, random), amp });
      total += amp;
    }
    return (u, v) => {
      let sum = 0;
      for (const layer of layers) sum += layer.noise(u, v) * layer.amp;
      return sum / total;
    };
  }

  // 1 → 0 across 0..1, smoothly; the falloff at a seam's edge.
  function softEdge(x) {
    x = Math.min(Math.max(x, 0), 1);
    return 1 - x * x * (3 - 2 * x);
  }

  function canvasFrom(pixels, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').putImageData(new ImageData(pixels, size, size), 0, 0);
    return canvas;
  }

  /* Tangent-space normals from a height field, by central differences. The
     green channel takes the row difference unflipped because a
     CanvasTexture is flipY: image rows run down, texture v runs up, so
     dh/dv is minus the row difference and -dh/dv is the row difference. */
  function normalMapFrom(height, size, strength) {
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      const row = y * size;
      const up = ((y - 1 + size) % size) * size;
      const down = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        const l = (x - 1 + size) % size;
        const r = (x + 1) % size;
        const nx = -(height[row + r] - height[row + l]) * strength;
        const ny = (height[down + x] - height[up + x]) * strength;
        const len = Math.hypot(nx, ny, 1);
        const i = (row + x) * 4;
        out[i] = 255 * (nx / len * 0.5 + 0.5);
        out[i + 1] = 255 * (ny / len * 0.5 + 0.5);
        out[i + 2] = 255 * (1 / len * 0.5 + 0.5);
        out[i + 3] = 255;
      }
    }
    return canvasFrom(out, size);
  }

  /* A repeating texture at a stated size in metres. The colour map is sRGB
     (it was drawn as colour); the normal and roughness maps are data and
     must not be converted. Anisotropy matters here more than anywhere: the
     floor is seen at a grazing angle for the whole dolly, and without it
     the boards smear to mud a metre out. */
  function textureFrom(canvas, tile, isColour) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / tile, 1 / tile);
    texture.colorSpace = isColour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  /* Oak boards, running toward the window so their lines converge on it.
     Each strip is its own board: its own tint, its own slight warmth, its
     own height (a real floor is never dead flat across a joint), and end
     joints at its own phase so they stagger. The grain is noise stretched
     hard along the board; the seams are drawn as a narrow groove with a
     wider, gentler bevel either side. All of it in grey and near-white —
     the oak colour stays the material's. */
  function drawFloor(spec, random) {
    const size = spec.size;
    const boardW = size / spec.boards;
    const jointSpacing = size / spec.joints;

    const strips = [];
    for (let i = 0; i < spec.boards; i++) {
      strips.push({
        phase: random() * jointSpacing,
        tint: 1 + (random() - 0.5) * 0.10,
        warm: (random() - 0.5) * 2,
        lift: (random() - 0.5) * 0.10,
        segments: Array.from({ length: spec.joints }, () => 1 + (random() - 0.5) * 0.12)
      });
    }

    const grain = fbm(random, 96, 3, 3);    // streaks: dense across, long along
    const micro = fbm(random, 96, 96, 2);   // the pores

    const colour = new Uint8ClampedArray(size * size * 4);
    const rough = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const i = y * size + x;

        const s = Math.min(Math.floor(x / boardW), spec.boards - 1);
        const strip = strips[s];

        // px to the nearest long edge of this strip...
        const edge = Math.min(x - s * boardW, (s + 1) * boardW - x);
        // ...and to the nearest end joint, along the strip (periodic in the tile)
        const along = (y - strip.phase + size * 2) % jointSpacing;
        const jointDist = Math.min(along, jointSpacing - along);
        const segment = strip.segments[
          Math.floor(((y - strip.phase + size * 2) % size) / jointSpacing) % spec.joints
        ];

        const gap = Math.min(edge, jointDist);
        const seam = softEdge(gap / 1.6);     // 1 in the groove
        const bevel = softEdge(gap / 4.5);    // the rounded edge either side of it

        const g = grain(u, v);
        const m = micro(u, v);

        let shade = strip.tint * segment
          * (1 + (g - 0.5) * 0.20)
          * (1 + (m - 0.5) * 0.06);
        shade *= 1 - seam * 0.55;
        const c = 242 * shade;
        const j = i * 4;
        colour[j] = c * (1 + strip.warm * 0.03);
        colour[j + 1] = c;
        colour[j + 2] = c * (1 - strip.warm * 0.03);
        colour[j + 3] = 255;

        // Roughness is read from G; the rest is filled so the map reads sanely if inspected.
        const r = spec.roughness + (0.5 - g) * 0.16;
        const rv = 255 * (r + (spec.seamRoughness - r) * seam);
        rough[j] = rv;
        rough[j + 1] = rv;
        rough[j + 2] = rv;
        rough[j + 3] = 255;

        height[i] = 0.5 + strip.lift
          + (g - 0.5) * 0.08
          + (m - 0.5) * 0.04
          - bevel * 0.18
          - seam * 0.35;
      }
    }

    return {
      map: textureFrom(canvasFrom(colour, size), spec.tile, true),
      roughnessMap: textureFrom(canvasFrom(rough, size), spec.tile, false),
      normalMap: textureFrom(normalMapFrom(height, size, spec.relief), spec.tile, false)
    };
  }

  /* Painted plaster: a broad, slow undulation from the trowel under a fine
     stipple from the roller. The colour barely moves — a few values either
     side of white — and the relief is where the surface actually shows,
     catching the raking window light as a faint texture rather than a
     gradient. */
  function drawPlaster(spec, random) {
    const size = spec.size;
    const broad = fbm(random, 6, 6, 4);
    const fine = fbm(random, 160, 160, 2);

    const colour = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const i = y * size + x;
        const b = broad(u, v);
        const f = fine(u, v);

        const c = 246 + (b - 0.5) * 8 + (f - 0.5) * 7;
        const j = i * 4;
        colour[j] = c;
        colour[j + 1] = c;
        colour[j + 2] = c;
        colour[j + 3] = 255;

        height[i] = (b - 0.5) * 0.5 + (f - 0.5) * 0.35;
      }
    }

    return {
      map: textureFrom(canvasFrom(colour, size), spec.tile, true),
      normalMap: textureFrom(normalMapFrom(height, size, spec.relief), spec.tile, false)
    };
  }

  function dressFloor(material) {
    material.map = surfaces.floor.map;
    material.normalMap = surfaces.floor.normalMap;
    material.roughnessMap = surfaces.floor.roughnessMap;
    material.roughness = 1.0;     // the map multiplies this, so it carries the value now
    material.metalness = 0.0;
    material.needsUpdate = true;
  }

  function dressPlaster(material) {
    material.map = surfaces.plaster.map;
    material.normalMap = surfaces.plaster.normalMap;
    material.roughness = 1.0;     // flat emulsion: no sheen at all
    material.metalness = 0.0;
    material.needsUpdate = true;
  }

  /* The shell's own UVs are the 0..1-per-face kind a box exporter writes,
     which would stretch one tile of boards across the whole floor. These are
     projected from world position instead, in metres, along whichever axis
     the face points down: so the back wall's four pieces around the window
     share one unbroken skim of plaster, and a tile is the size it was drawn
     at on every surface. The geometry is cloned first — boxes in the model
     may share one, and the others keep their UVs. */
  function projectShellUVs(mesh) {
    const geometry = mesh.geometry.clone();
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = new Float32Array(position.count * 2);

    mesh.updateWorldMatrix(true, false);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix);
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      if (ay >= ax && ay >= az) {        // floor, ceiling
        uv[i * 2] = p.x;
        uv[i * 2 + 1] = p.z;
      } else if (ax >= az) {             // side walls
        uv[i * 2] = p.z;
        uv[i * 2 + 1] = p.y;
      } else {                           // back wall
        uv[i * 2] = p.x;
        uv[i * 2 + 1] = p.y;
      }
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.geometry = geometry;
  }

  function onRoomLoaded(gltf) {
    const room = gltf.scene;
    room.name = 'studioRoom';

    /* The parts of the room that must not cast: the sky card outside the
       window and the glass in front of it would both block the key light and
       kill the light pool on the floor, and the ceiling would seal the room
       into a shadowed box. */
    const NO_CAST = new Set(['window_sky', 'window_glass', 'ceiling']);

    /* The shell: the surfaces that are the room rather than in it. These
       get the textures drawn in SURFACES, and the UVs to carry them. */
    const SHELL = new Set([
      'floor', 'ceiling', 'wall_left', 'wall_right',
      'wall_back_below', 'wall_back_above', 'wall_back_left', 'wall_back_right'
    ]);

    room.traverse((node) => {
      if (!node.isMesh) return;

      node.castShadow = !NO_CAST.has(node.name);
      node.receiveShadow = true;

      if (SHELL.has(node.name)) projectShellUVs(node);

      const material = node.material;
      if (!material) return;

      /* Every surface reflects the same room; see ENVIRONMENT above. */
      if ('envMapIntensity' in material) material.envMapIntensity = ENV.intensity;

      /* The ceiling shares its material with every piece of white trim in
         the room, and the plaster belongs on it alone, so it gets a copy. */
      if (node.name === 'ceiling') {
        const plaster = material.clone();
        plaster.name = 'ceiling_plaster';
        dressPlaster(plaster);
        node.material = plaster;
        return;
      }

      switch (material.name) {
        /* The view out of the window is one flat card. Pushing its emissive
           well past 1 is what makes it clip to white through ACES, so the
           window reads as blown-out daylight rather than as pale blue paint. */
        case 'sky':
          material.emissive = new THREE.Color(0xf6f9ff);
          material.emissiveIntensity = 3.4;
          node.frustumCulled = false;
          break;

        /* Barely-there glazing: enough to catch a highlight along the mullion,
           not enough to grey the sky behind it. */
        case 'glass_pale':
          material.transparent = true;
          material.opacity = 0.10;
          material.roughness = 0.05;
          material.depthWrite = false;
          break;

        /* Boards, seams and a sheen that varies with the grain — see
           SURFACES. Long floorboards read as a mirror at grazing angles if
           they stay as smooth as the model's default, and that sheen crawls
           as the camera moves down the dolly; the roughness map is what
           breaks it up. */
        case 'floor_oak':
          dressFloor(material);
          break;

        /* Flat paint over plaster. Left as-is it picks up a specular sheen
           off the window light that no emulsion wall would have, and shows
           the tone-mapper's banding for want of anything to break it. */
        case 'wall_paint':
        case 'wall_paint_shadowed':
          dressPlaster(material);
          break;

        /* The panel in its OFF state. Emissive is pre-wired at zero intensity
           so Phase 5 only has to raise it — no material swap, so no shader
           recompile mid-animation. */
        case 'screen_off':
          material.emissive = new THREE.Color(0x000000);
          material.emissiveIntensity = 0.0;
          break;

        /* The power cap and the glyph inset into it, wired the same way and
           for the same reason. These two materials are carried by those two
           meshes and nothing else in the model, so raising the intensity
           lights the button alone — no keycap comes up with it. */
        case 'power_key':
        case 'power_glyph':
          material.emissive = new THREE.Color(0x8ef06a);   // --accent
          material.emissiveIntensity = 0.0;
          // Kept as a pair: the cue lights the cap and its glyph together, so
          // the glow has to be written to both. Guarded because the traversal
          // is per-mesh and a material may be carried by more than one.
          if (!props.powerMaterials.includes(material)) {
            props.powerMaterials.push(material);
          }
          break;
      }
    });

    /* Named handles for the later phases, resolved once here rather than
       per-frame. */
    props.room = room;
    props.desk = room.getObjectByName('desk_top') || null;
    props.chair = room.getObjectByName('chair_seat_frame') || null;
    props.laptop = room.getObjectByName('laptop_base') || null;
    props.keyWell = room.getObjectByName('key_well') || null;
    props.screen = room.getObjectByName('screen') || null;
    props.powerButton = room.getObjectByName('power_button') || null;

    detailLaptop(room);

    scene.add(room);
    scene.updateMatrixWorld(true);

    /* World-space anchors, measured rather than assumed. Note this takes the
       centre of the world-space bounding box and not `getWorldPosition`:
       every mesh in this model is authored with its origin at the corner of
       its own box, so a node's own position lands half a part off — half a
       laptop off, in the case of the parts being aimed at here. */
    if (props.screen) {
      props.screenMaterial = props.screen.material;
      worldCentre(props.screen, props.screenPos);

      /* The chat UI goes onto the panel now, not at the press: it is
         invisible until then, but a CSS3DObject already in place costs
         nothing to carry and it means the element has been display:'' for
         seconds before its opacity transition has to run. */
      measureScreenPlane();
      placeScreenUI();
    }
    if (props.keyWell) worldCentre(props.keyWell, props.keyWellPos);
    if (props.powerButton) {
      props.powerButtonMaterial = props.powerButton.material;
      worldCentre(props.powerButton, props.powerButtonPos);
      addPowerHotspot();
    }

    /* Re-aim the end of the dolly at the parts as measured. `END.target` is
       one of the aim curve's own control points, held by reference, so
       writing to it in place is the whole update — there is no path to
       rebuild and no frame where the two disagree. */
    if (props.keyWell && props.powerButton) {
      END.target.lerpVectors(props.keyWellPos, props.powerButtonPos, POWER_BIAS);
      updateEndPosition();
    }
  }

  function onRoomFailed(error) {
    // Nothing to fall back to — say so plainly rather than leaving a black
    // canvas with no explanation in the console.
    console.error(`[cinematic-scene] could not load ${MODEL_URL}`, error);
  }

  /* ---------------------------------------------------------------------
     THE LAPTOP — detail pass
     The model already carries the laptop as parts: the aluminium base and
     deck, a recessed key well with every keycap (a wide spacebar included),
     the trackpad in its own darker well, the hinge barrel and caps, and the
     lid as shell, bezel plate and panel. What it does not carry is any
     texture — the GLB ships without images — so the keycaps are blank grey
     tiles, the trackpad is the same silver as the deck around it, and the
     hinge is the same mid-grey as the trackpad rim. At the end of the dolly
     the lens is a hand's width above the key well, and blank keys are the
     first thing that gives the laptop away as a model.

     This pass adds the missing detail in code and leaves the geometry alone:
     a procedurally drawn keycap atlas (Windows legend layout, shaded key
     faces) mapped onto the existing 3D caps, and three material tweaks that
     separate the trackpad, the hinge line and the bezel from the parts around
     them. Everything stays in the scene's grey/black/white — it is a detail
     upgrade, not a recolour. The power button and the panel are deliberately
     skipped: both carry the emissive channels Phase 5 animates.
     --------------------------------------------------------------------- */

  /* Legend layout — one entry per keycap mesh, `key_<row>_<col>`. The model
     gives every row uniform caps (no wide Enter or Shift), so the wide keys
     just get their legend on a normal cap and the two spare columns at the
     right of each row take the navigation keys a Windows laptop puts there.
     Row 5 is Ctrl · Fn · ⊞ · Alt · (blank) · spacebar · Alt · Ctrl · arrows;
     the spacebar is `key_5_5` and spans columns 5–9, so 6–9 do not exist.
     Row 0's fifteenth cap is the power button, which is not textured. */
  const WIN_KEY = '\u0001';   // sentinel: draw the four-pane logo, not text
  const KEY_LEGENDS = [
    ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Del'],
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace', 'Home'],
    ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'PgUp'],
    ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter', 'PgDn', 'End'],
    ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift', '\u2191', 'Ins', 'PrtSc'],
    ['Ctrl', 'Fn', WIN_KEY, 'Alt', '', '', '', '', '', '', 'Alt', 'Ctrl', '\u2190', '\u2193', '\u2192']
  ];

  /* The atlas: 16 tiles across by 8 down at 128px — power-of-two overall so
     the mip chain is clean, with the two spare rows left black. Each tile is
     one key face; the spacebar takes a run of five tiles on row 5. */
  const ATLAS = {
    tile: 128,
    cols: 16,
    rows: 8,
    spacebarCol: 5,
    spacebarSpan: 5,
    face: '#50535a',      // key face — the model's keycap grey, held in sRGB
    legend: '#e2e5eb',    // near-white legend, like a backlit Windows deck
    minFontPx: 18
  };

  const LAPTOP_FINISH = {
    trackpad: { colour: 0xc9ccd2, roughness: 0.20, metalness: 0.55 },  // matte glass, a step down from the deck
    hinge:    { colour: 0x24262a, roughness: 0.42, metalness: 0.70 },  // the dark line the lid pivots on
    bezel:    { roughness: 0.20 }                                       // glass over the bezel, not painted plastic
  };

  function detailLaptop(room) {
    /* The laptop sits on the desk at a slight yaw, and that yaw is baked into
       every mesh's vertices — no node carries a rotation. Measured off two
       caps on the function row rather than hardcoded so a re-export of the
       model at a different angle keeps the legends square on the keys. */
    const rowStart = room.getObjectByName('key_0_0');
    const rowEnd = room.getObjectByName('key_0_13');
    const yaw = (rowStart && rowEnd)
      ? Math.atan2(-(rowEnd.position.z - rowStart.position.z), rowEnd.position.x - rowStart.position.x)
      : 0;

    /* Pass 1: give every cap its own copy of the geometry with UVs that map
       its top face onto its tile. Caps share four geometries in the model, so
       the clone is what keeps one key's legend off every other key. */
    const keyPattern = /^key_(\d+)_(\d+)$/;
    const tiles = [];
    let keycapMaterial = null;

    room.traverse((node) => {
      if (!node.isMesh) return;
      const match = keyPattern.exec(node.name);
      if (!match) return;

      const row = Number(match[1]);
      const col = Number(match[2]);
      if (row >= ATLAS.rows) return;

      const isSpacebar = row === 5 && col === ATLAS.spacebarCol;
      const span = isSpacebar ? ATLAS.spacebarSpan : 1;
      if (col + span > ATLAS.cols) return;

      const legend = (KEY_LEGENDS[row] && KEY_LEGENDS[row][col]) || '';
      const aspect = projectTopFace(node, yaw, {
        u0: col / ATLAS.cols,
        v0: 1 - (row + 1) / ATLAS.rows,
        w: span / ATLAS.cols,
        h: 1 / ATLAS.rows
      });

      tiles.push({ row, col, span, legend, aspect });

      /* One material for every cap, cloned from the model's own so the PBR
         values stay what the scene was lit for. Colour goes to white because
         the face colour is painted into the atlas, and the map multiplies. */
      if (!keycapMaterial) {
        keycapMaterial = node.material.clone();
        keycapMaterial.color.setHex(0xffffff);
      }
      node.material = keycapMaterial;
    });

    if (keycapMaterial) {
      keycapMaterial.map = drawKeycapAtlas(tiles);
      keycapMaterial.needsUpdate = true;
    }

    /* Pass 2: the three finishes. Each part's material is shared with other
       parts of the laptop (the trackpad with the deck, the hinge with the
       trackpad rim), so clone before changing — the deck must stay silver. */
    const trackpad = room.getObjectByName('trackpad');
    if (trackpad && trackpad.isMesh) {
      const finish = trackpad.material.clone();
      finish.color.setHex(LAPTOP_FINISH.trackpad.colour);
      finish.roughness = LAPTOP_FINISH.trackpad.roughness;
      finish.metalness = LAPTOP_FINISH.trackpad.metalness;
      trackpad.material = finish;
    }

    let hingeMaterial = null;
    for (const name of ['hinge_barrel', 'hinge_cap_l', 'hinge_cap_r']) {
      const part = room.getObjectByName(name);
      if (!part || !part.isMesh) continue;
      if (!hingeMaterial) {
        hingeMaterial = part.material.clone();
        hingeMaterial.color.setHex(LAPTOP_FINISH.hinge.colour);
        hingeMaterial.roughness = LAPTOP_FINISH.hinge.roughness;
        hingeMaterial.metalness = LAPTOP_FINISH.hinge.metalness;
      }
      part.material = hingeMaterial;
    }

    /* The bezel material is the model's own and carried by the bezel alone,
       so it is tuned in place: lower roughness reads as the glass sheet that
       runs edge to edge over a modern panel's border. */
    const bezel = room.getObjectByName('lid_bezel');
    if (bezel && bezel.isMesh) {
      bezel.material.roughness = LAPTOP_FINISH.bezel.roughness;
    }
  }

  /* Rewrites a mesh's UVs as a planar projection of its top face into the
     given atlas rectangle, in the laptop's own (un-yawed) frame. Every vertex
     gets the projection, so the cap's sides pick up the tile's edge colour —
     which is the face colour, so they stay plain. Returns width ÷ depth of
     the face, which the atlas needs to keep legends round on the half-height
     function row. */
  function projectTopFace(mesh, yaw, rect) {
    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;

    const position = geometry.attributes.position;
    const count = position.count;
    let uv = geometry.attributes.uv;
    if (!uv || uv.itemSize !== 2 || uv.count !== count) {
      uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
      geometry.setAttribute('uv', uv);
    }

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const ux = x * c - z * s;
      const uz = x * s + z * c;
      if (ux < minX) minX = ux;
      if (ux > maxX) maxX = ux;
      if (uz < minZ) minZ = uz;
      if (uz > maxZ) maxZ = uz;
    }

    const width = Math.max(maxX - minX, 1e-6);
    const depth = Math.max(maxZ - minZ, 1e-6);

    /* v runs from the near edge (max z, towards the viewer) at the bottom of
       the tile to the far edge at the top, so legends read upright from the
       chair. CanvasTexture keeps flipY, so v=1 is the top of the drawing. */
    for (let i = 0; i < count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const u = (x * c - z * s - minX) / width;
      const v = (maxZ - (x * s + z * c)) / depth;
      uv.setXY(i, rect.u0 + u * rect.w, rect.v0 + v * rect.h);
    }
    uv.needsUpdate = true;

    return width / depth;
  }

  function drawKeycapAtlas(tiles) {
    const T = ATLAS.tile;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS.cols * T;
    canvas.height = ATLAS.rows * T;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const tile of tiles) {
      const x = tile.col * T;
      const y = tile.row * T;
      const w = tile.span * T;
      const h = T;

      // The face, then a soft fall-off to the edges standing in for the
      // rounded-edge shading a real cap has, so each key reads as its own
      // small pillow rather than as a flat square of grey.
      ctx.fillStyle = ATLAS.face;
      ctx.fillRect(x, y, w, h);
      const shade = ctx.createRadialGradient(
        x + w / 2, y + h / 2, Math.min(w, h) * 0.18,
        x + w / 2, y + h / 2, Math.max(w, h) * 0.74
      );
      shade.addColorStop(0, 'rgba(255,255,255,0.06)');
      shade.addColorStop(1, 'rgba(0,0,0,0.26)');
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, w, h);

      if (!tile.legend) continue;

      /* A square tile lands on a cap that is `aspect` times wider than deep,
         so pre-stretch the legend vertically by that much to keep it round —
         it is what stops the function-row legends from squashing. */
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(1, tile.aspect);

      if (tile.legend === WIN_KEY) {
        drawWindowsLogo(ctx, T * 0.30);
      } else {
        const single = tile.legend.length === 1;
        let px = single ? T * 0.46 : T * 0.24;
        ctx.font = `500 ${px}px "Segoe UI", system-ui, -apple-system, sans-serif`;
        const maxWidth = w * 0.82;
        const measured = ctx.measureText(tile.legend).width;
        if (measured > maxWidth) {
          px = Math.max(ATLAS.minFontPx, px * (maxWidth / measured));
          ctx.font = `500 ${px}px "Segoe UI", system-ui, -apple-system, sans-serif`;
        }
        ctx.fillStyle = ATLAS.legend;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.legend, 0, 0, maxWidth);
      }
      ctx.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // The deck is seen at a grazing angle for most of the dolly; without
    // anisotropy the legends smear into streaks long before the lens arrives.
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  /* The four-pane Windows logo, drawn rather than typed: the ⊞ glyph is not
     in every fallback font and the tofu box would sit on the most
     recognisable key on the deck. Size is the logo's full width. */
  function drawWindowsLogo(ctx, size) {
    const gap = size * 0.08;
    const pane = (size - gap) / 2;
    ctx.fillStyle = ATLAS.legend;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillRect(
          -size / 2 + col * (pane + gap),
          -size / 2 + row * (pane + gap),
          pane,
          pane
        );
      }
    }
  }

  const measureBox = new THREE.Box3();

  function worldCentre(object, out) {
    return measureBox.setFromObject(object).getCenter(out);
  }

  /* ---------------------------------------------------------------------
     THE POWER BUTTON
     It is already its own object: `power_button` is a discrete 17mm mesh
     sitting where the top-right key would be, carrying its own `power_key`
     material with a `power_glyph` icon inset into it. Nothing has to be
     built. What it lacks is a target big enough to hit.
     --------------------------------------------------------------------- */

  /* 17mm is a real target for a mouse at the end of the dolly, but a fiddly
     one, and nothing at all under a thumb. This is a 5cm invisible disc lying
     on top of the cap, existing only so the next phase can raycast against a
     forgiving hitbox instead of against the geometry. Three raycasts meshes
     whose `visible` is false, so it costs nothing to draw — and with
     matrixAutoUpdate off, nothing per frame either. */
  function addPowerHotspot() {
    const hotspot = new THREE.Mesh(
      new THREE.CircleGeometry(0.025, 24),
      new THREE.MeshBasicMaterial()
    );
    hotspot.name = 'power_hotspot';
    hotspot.rotation.x = -Math.PI / 2;          // lie flat on the deck
    hotspot.position.copy(props.powerButtonPos);
    hotspot.position.y += 0.004;                // just clear of the cap's face
    hotspot.visible = false;
    hotspot.castShadow = false;
    hotspot.receiveShadow = false;
    hotspot.matrixAutoUpdate = false;
    hotspot.updateMatrix();
    scene.add(hotspot);
    props.powerHotspot = hotspot;
  }

  /* ---------------------------------------------------------------------
     THE CAMERA PATH
     Two Catmull-Rom curves — one for the lens, one for what it is pointed at
     — both sampled at the same eased scroll position, so position and aim
     always move together and there is nothing to cut between.

     The two middle control points on the lens curve are what stop the move
     from being a straight line drawn through the furniture: the camera rises
     to standing height as it comes forward, clears the chair back (top at
     y=0.869) with room to spare, and only then drops onto the desk. Both
     curves are left on Three's default centripetal parameterisation, which is
     the one that cannot cusp or overshoot on unevenly spaced points like
     these — and getPoint, not getPointAt, so the long opening segment is
     covered faster than the short closing one. That is the right shape here:
     ground is crossed quickly at distance and slowly up close.
     --------------------------------------------------------------------- */

  // Filled by updateEndPosition, and held live by the curve below.
  const endPosition = new THREE.Vector3();
  updateEndPosition();

  const lensPath = new THREE.CatmullRomCurve3([
    SHOT.position,
    new THREE.Vector3(0.03, 1.52, -0.75),   // stood up, walking in
    new THREE.Vector3(0.01, 1.30, -1.72),   // over the chair, starting to drop
    endPosition
  ]);

  const aimPath = new THREE.CatmullRomCurve3([
    SHOT.target,                             // the window in the back wall
    new THREE.Vector3(-0.18, 0.82, -2.70),
    new THREE.Vector3(-0.06, 0.81, -2.50),   // drifting down onto the desk
    END.target
  ]);

  /* Derives the closing camera position from the aim point, the tip of the
     lens and the window's aspect ratio. Rerun on every resize: at 21:9 the
     camera can sit closer than at 4:3 for the same amount of desk across the
     frame, and in a portrait window it pulls back until the clamp stops it. */
  function updateEndPosition() {
    const halfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5;
    const widthPerMetre = 2 * Math.tan(halfFov) * camera.aspect;
    const distance = THREE.MathUtils.clamp(
      END.frameWidth / widthPerMetre,
      END.minDistance,
      END.maxDistance
    );

    endPosition.set(
      END.target.x,
      END.target.y + Math.sin(END.pitch) * distance,
      END.target.z + Math.cos(END.pitch) * distance
    );
  }

  /* ---------------------------------------------------------------------
     SCROLL
     The scroll being read is #cineIntro's own, not the document's: <body> is
     overflow:hidden and has to stay that way for the chat UI underneath, so
     the overlay is its own scroll container over a tall track. The travel is
     measured off that element rather than assumed, so the CSS height and this
     module cannot drift apart.
     --------------------------------------------------------------------- */

  let scrollProgress = 0;   // where the scroll position actually is, 0..1
  let dollyProgress = 0;    // where the camera has caught up to
  let dollyT = 0;           // ...eased; held after the press for the cue below

  function readScroll() {
    if (!scroller) return 0;
    const travel = scroller.scrollHeight - scroller.clientHeight;
    if (travel <= 0) return 0;
    return THREE.MathUtils.clamp(scroller.scrollTop / travel, 0, 1);
  }

  /* Smoothstep, not a cubic ease: both ends of the move want to be gentle,
     but an ease that flat would leave the first inch of scroll looking dead. */
  function smoothstep(x) {
    return x * x * (3 - 2 * x);
  }

  /* Eased at both ends but steeper through the middle than smoothstep is, so
     the second and a bit of the power-on move reads as a deliberate push
     rather than as a drift. Both ends still have to be soft: the camera has
     been sitting still, and leaving a settled shot at full speed is
     indistinguishable from a cut. */
  function easeMove(x) {
    return x < 0.5
      ? 4 * x * x * x
      : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  /* The cue has done its job the moment the shot starts moving, and it is a
     one-way trip: bringing it back if you scroll to the top again would read
     as a bug rather than as help. The threshold is above zero so a trackpad's
     idle jitter doesn't dismiss it before it has been seen. */
  function retireScrollCue(progress) {
    if (!scrollCue || progress < 0.015) return;
    scrollCue.classList.add('is-gone');
    scrollCue = null;
  }

  /* ---------------------------------------------------------------------
     DEPTH OF FIELD
     A composer chain — RenderPass → BokehPass → OutputPass — pulled in
     asynchronously, and entirely optional: if any of the three fails to load
     off the CDN the module keeps rendering through the plain renderer and
     only the blur is missing. Nothing above this point knows it exists.
     --------------------------------------------------------------------- */

  let composer = null;
  let bokehPass = null;

  setUpDepthOfField();

  async function setUpDepthOfField() {
    try {
      const [
        { EffectComposer },
        { RenderPass },
        { BokehPass },
        { OutputPass }
      ] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/BokehPass.js'),
        import('three/addons/postprocessing/OutputPass.js')
      ]);

      const chain = new EffectComposer(renderer);
      chain.addPass(new RenderPass(scene, camera));

      const bokeh = new BokehPass(scene, camera, {
        focus: 1.0,
        aperture: 0,
        maxblur: DOF.maxblur
      });
      bokeh.enabled = false;    // nothing to blur until the move starts
      chain.addPass(bokeh);

      /* OutputPass has to come last and is not optional. Passes render into
         linear HDR targets, and rendering to a target is exactly the case
         where the renderer skips the ACES pass and the sRGB conversion it
         does when drawing straight to the canvas — so without this the room
         comes back washed out and the blown window goes flat grey. */
      chain.addPass(new OutputPass());

      chain.setPixelRatio(renderer.getPixelRatio());
      chain.setSize(window.innerWidth, window.innerHeight);

      composer = chain;
      bokehPass = bokeh;
    } catch (error) {
      console.warn(
        '[cinematic-scene] depth of field unavailable — falling back to the plain renderer',
        error
      );
    }
  }

  /* The focal plane is simply whatever the lens is pointed at, so the key
     well stays sharp while the room behind it goes. `aperture` is what
     actually ramps: zero through the establishing shot, opening up over the
     back two thirds of the move. Below that the pass is switched off outright
     rather than left running at zero — it is 41 texture fetches per pixel,
     and there is no reason to pay for them to sample the same texel 41
     times. */
  function updateDepthOfField(t) {
    if (!bokehPass) return;

    const ramp = smoothstep(
      THREE.MathUtils.clamp((t - DOF.start) / (1 - DOF.start), 0, 1)
    ) * dofFade;

    bokehPass.enabled = ramp > 0.001;
    if (!bokehPass.enabled) return;

    bokehPass.uniforms.focus.value = camera.position.distanceTo(cameraTarget);
    bokehPass.uniforms.aperture.value = DOF.aperture * ramp;
  }

  /* ---------------------------------------------------------------------
     PHASE 5, PART 1 — ARMING THE POWER BUTTON
     The dolly parks the lens directly over `props.powerHotspot`, the 5cm
     invisible disc laid on the cap above. This is what makes that disc mean
     something: a glow that comes up as the shot settles, and a pointer test
     that only answers once the shot has actually arrived.

     Deliberately raycast on demand rather than per frame. A hover test costs
     one ray against one 24-segment circle, and only when the pointer moves —
     doing it in the render loop would pay for it 60 times a second to learn
     that the pointer has not moved.
     --------------------------------------------------------------------- */

  let armed = false;        // is the button accepting clicks?
  let hovering = false;     // pointer over the cap, mouse only
  let pressFlash = 0;       // 1 on the click, decaying to 0
  let powered = false;      // is the power-on move (either direction) driving?
  let isPoweredOn = false;  // ...and has it arrived? true only on the lit panel
  let powerDir = 1;         // +1 powering on, -1 powering back off
  let lastGlow = -1;        // so a still frame writes no uniforms at all

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function hitsPowerButton(event) {
    /* The cap itself is the fallback: 17mm is a fiddly target, but a fiddly
       target beats none if the hotspot never got built. */
    const target = props.powerHotspot || props.powerButton;
    if (!target) return false;

    /* Against the canvas's own box rather than the viewport's. They are the
       same box here, but reading it is what keeps this correct if the canvas
       is ever inset or letterboxed. */
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    // `false`: the hotspot has no children, and the cap's glyph is a sibling.
    return raycaster.intersectObject(target, false).length > 0;
  }

  /* pointerdown paired with pointerup, rather than `click`. The canvas is
     sticky inside a scroll container, so on a touchscreen the very drag that
     finishes the dolly can end with a finger sitting on the button — and a
     drag that happens to release there is a scroll, not a press. Both ends of
     the gesture have to land on the cap, within a finger's worth of travel of
     each other. */
  const PRESS_SLOP = 10;   // px; the usual allowance for a finger held still

  let downX = 0;
  let downY = 0;
  let downOnButton = false;

  function onPointerDown(event) {
    downX = event.clientX;
    downY = event.clientY;
    downOnButton = armed && !powered && hitsPowerButton(event);
  }

  function onPointerUp(event) {
    if (!downOnButton) return;
    downOnButton = false;

    if (Math.hypot(event.clientX - downX, event.clientY - downY) > PRESS_SLOP) {
      return;   // the gesture was a scroll that happened to start on the cap
    }

    /* Re-tested rather than trusted: the scroll can have moved under the
       finger between the two halves of the gesture, which would take the
       button back out of reach and the cap out from under the pointer. */
    if (!armed || powered || !hitsPowerButton(event)) return;

    pressPower();
  }

  function onPointerCancel() {
    downOnButton = false;
  }

  function onPointerMove(event) {
    // A finger has no hover state, and testing for one would leave the cap
    // stuck lit at `hover` after the tap that moved the pointer there.
    if (event.pointerType === 'touch') return;

    const over = armed && !powered && hitsPowerButton(event);
    if (over === hovering) return;

    hovering = over;
    canvas.style.cursor = over ? 'pointer' : '';
  }

  function onPointerLeave() {
    if (!hovering) return;
    hovering = false;
    canvas.style.cursor = '';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);

  function pressPower() {
    powered = true;
    powerDir = 1;
    hovering = false;
    pressFlash = 1;
    canvas.style.cursor = '';

    /* Where the push starts: wherever the dolly had actually settled on this
       frame, aim included. Taken from the live camera rather than from the
       end of the path, so the move begins without a cut whatever the damping
       was still doing when the press landed. */
    pressPosition.copy(camera.position);
    pressTarget.copy(cameraTarget);
    pressQuaternion.copy(camera.quaternion);
    powerClock = 0;

    /* Measured again now, not only at load: the panel's world matrix is
       certainly up to date by the time anything has been clicked, and the
       framing depends on the window's aspect ratio, which is only knowable
       this late. The UI is re-placed off the same measurement so the two can
       never disagree. */
    measureScreenPlane();
    placeScreenUI();
    updateScreenViewPosition();

    /* The panel's emissive is already on the material at zero intensity (see
       the `screen_off` case in the traversal), so waking it is one uniform
       and no shader recompile mid-move — the colour is all that is left to
       set, and it only has to be set once. */
    if (props.screenMaterial) {
      props.screenMaterial.emissive.setHex(SCREEN.colour);
    }

    /* The camera is off the scroll while the panel owns the frame. Locking
       the container stops a trackpad's tail-end momentum from dragging the
       track under a shot that no longer answers to it — and the position it
       is locked at is kept, because the power-off hands the camera back to
       the dolly exactly where the press took it away. */
    if (scroller) {
      pressScrollTop = scroller.scrollTop;
      scroller.style.overflowY = 'hidden';
    }

    /* Announced as an event rather than wired to a call, so this module keeps
       its promise of never reaching into script.js. `cine:screen-on` follows
       it once the panel is lit and the lens has arrived. */
    window.dispatchEvent(new CustomEvent('cine:power'));
  }

  /* One number, on two materials, and only when it has actually moved: a
     camera parked at the top of the track writes no uniforms at all. */
  function setPowerGlow(intensity) {
    if (Math.abs(intensity - lastGlow) < 0.001) return;
    lastGlow = intensity;
    for (const material of props.powerMaterials) {
      material.emissiveIntensity = intensity;
    }
  }

  function updatePowerCue(t, dt, seconds) {
    armed = t >= ARM.full;

    if (pressFlash > 0) {
      pressFlash = Math.max(0, pressFlash - GLOW.pressDecay * dt);
    }

    let intensity;

    if (powered) {
      intensity = GLOW.hover + (GLOW.press - GLOW.hover) * pressFlash;
    } else if (hovering) {
      intensity = GLOW.hover;
    } else {
      /* Below `full` this is only the ramp: the cap fades up as the lens
         arrives, so the glow reaching its resting brightness is itself the
         signal that the button can now be pressed. The breath starts on the
         same frame the clicks do — a pulse on something that isn't listening
         yet would be a lie. */
      const ramp = smoothstep(THREE.MathUtils.clamp(
        (t - ARM.begin) / (ARM.full - ARM.begin), 0, 1
      ));
      const breath = armed
        ? 0.5 - 0.5 * Math.cos(seconds * Math.PI * 2 * GLOW.breathHz)
        : 0;

      intensity = ramp * (GLOW.base + (GLOW.peak - GLOW.base) * breath);
    }

    setPowerGlow(intensity);
  }

  /* ---------------------------------------------------------------------
     PHASE 5, PART 2 — THE POWER-ON
     One move, run off its own clock rather than off the scroll: the camera
     leaves the deck close-up and comes to rest square in front of the panel,
     which lights on the way in. Once `powered` is set the dolly is never
     sampled again — the two cannot fight over the camera, because only one of
     them is driving it on any given frame.
     --------------------------------------------------------------------- */

  let powerClock = 0;          // seconds into the move; runs backwards on the way out
  let handedOff = false;       // has `cine:screen-on` gone out?
  let uiAwake = false;         // has the chat UI started fading in?
  let uiFlat = false;          // is the chat UI laid flat, out of the CSS3D scene? (see FLAT SCREEN UI)
  let dofFade = 1;             // the room blur, faded out as the panel arrives
  let lastScreenGlow = -1;     // as with lastGlow: no uniform write on a hold
  let pressScrollTop = 0;      // the scroll position the press froze, restored on the way out

  const pressPosition = new THREE.Vector3();
  const pressTarget = new THREE.Vector3();
  const pressQuaternion = new THREE.Quaternion();  // the aim at the press
  const screenView = new THREE.Vector3();   // where the lens ends up

  /* The panel as a plane rather than as a mesh — centre, the direction it
     faces, its own up and right, and its size in metres — because that is
     what framing a shot on it needs. The lid is raked back, so neither a
     world-space box around it nor its local axes describe the panel: the
     rake is baked into the vertices (the `screen` node carries a translation
     and nothing else), which means the geometry's own Z is the lid's *box*
     depth and not the direction the panel faces. Everything here is measured
     off the front face itself by `measureScreenPlane` before the move
     starts; the values below are only a placeholder shape.

     `up` is world Y flattened into the panel's plane, which for a lid with
     no roll is the panel's own up axis — so the picture lands straight with
     the rake taken out of it, not merely centred. */
  const screenPlane = {
    centre: props.screenPos.clone(),
    normal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    width: 0.30,
    height: 0.20
  };

  /* The orientation the lens ends the move in: square down the panel's
     normal. Held as a quaternion rather than as a look-at target because a
     target only fixes where the camera points — the roll and the rake still
     have to come from the panel's own basis, or a lid tilted back reads as a
     laptop shot from below instead of as a monitor shot head-on. */
  const screenQuaternion = new THREE.Quaternion();
  const screenBasis = new THREE.Matrix4();

  /* Read off the triangles rather than off any bounding box: the front face
     is the largest-area run of co-oriented triangles that faces back into
     the room, and its own vertices give the centre, the true panel extents
     (which are shorter than the box's, since the box measures the rake as
     well) and the normal the shot is taken down. */
  function measureScreenPlane() {
    const mesh = props.screen;
    if (!mesh) return;

    mesh.updateWorldMatrix(true, false);

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;

    const index = geometry.getIndex();
    const count = index ? index.count : position.count;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const facing = new THREE.Vector3();

    /* Triangles grouped by the direction they face. 0.999 is a hair under a
       degree of spread: enough to hold a face split into two triangles
       together, tight enough that the bezel's chamfer does not join it. */
    const faces = [];

    for (let i = 0; i < count; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;

      a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      facing.crossVectors(ab, ac);

      const area = facing.length() * 0.5;
      if (area < 1e-9) continue;      // degenerate; contributes no direction
      facing.divideScalar(area * 2);

      let face = null;
      for (const candidate of faces) {
        if (candidate.normal.dot(facing) > 0.999) { face = candidate; break; }
      }
      if (!face) {
        face = { normal: facing.clone(), area: 0, points: [] };
        faces.push(face);
      }

      face.area += area;
      face.points.push(a.clone(), b.clone(), c.clone());
    }

    /* Into the room means +Z: the whole dolly runs down the room's Z toward
       the back wall, so the face the camera has to end up in front of is the
       one pointing back at it. Of those, the panel is simply the biggest —
       the lid's edges and its back are all a fraction of its area. */
    let front = null;
    for (const face of faces) {
      if (face.normal.z <= 0) continue;
      if (!front || face.area > front.area) front = face;
    }
    if (!front) return;

    screenPlane.normal.copy(front.normal);

    /* World Y with the normal's share of it removed — the steepest uphill
       direction that still lies in the panel. Cross the other way round and
       the basis comes out left-handed and the picture mirrored. */
    screenPlane.up
      .set(0, 1, 0)
      .addScaledVector(screenPlane.normal, -screenPlane.normal.y)
      .normalize();
    screenPlane.right
      .crossVectors(screenPlane.up, screenPlane.normal)
      .normalize();

    /* Extents in the panel's own axes rather than in world ones, so the rake
       is measured out of the height instead of into it. */
    let minRight = Infinity, maxRight = -Infinity;
    let minUp = Infinity, maxUp = -Infinity;
    let depth = 0;

    for (const point of front.points) {
      const r = point.dot(screenPlane.right);
      const u = point.dot(screenPlane.up);
      if (r < minRight) minRight = r;
      if (r > maxRight) maxRight = r;
      if (u < minUp) minUp = u;
      if (u > maxUp) maxUp = u;
      depth += point.dot(screenPlane.normal);
    }
    depth /= front.points.length;   // the face is planar, so this is its plane

    screenPlane.width = maxRight - minRight;
    screenPlane.height = maxUp - minUp;

    screenPlane.centre
      .copy(screenPlane.right).multiplyScalar((minRight + maxRight) * 0.5)
      .addScaledVector(screenPlane.up, (minUp + maxUp) * 0.5)
      .addScaledVector(screenPlane.normal, depth);

    /* The camera looks down its own -Z, so its +Z is the panel's normal: the
       lens ends up facing the panel squarely, with the panel's up as its up.
       This is the whole fix for the skew — a look-at would leave the camera
       pointing at the centre of a surface it is still oblique to. */
    screenBasis.makeBasis(
      screenPlane.right,
      screenPlane.up,
      screenPlane.normal
    );
    screenQuaternion.setFromRotationMatrix(screenBasis);
  }

  /* Puts the chat UI on the panel. The CSS3DObject's element is given the
     panel's virtual resolution — SCREEN_UI.pixelsAcross by the measured
     aspect — and the object is scaled so that box spans the panel's width
     in metres; it sits at the panel's centre with the panel's own basis
     (right, up, normal) as its axes, so the element's front faces back into
     the room the way the glass does and the lid's rake is on it exactly.
     The scale wrapper inside is laid out at the design size and drawn down
     to the box (see SCREEN_UI).

     Sizes are rounded to whole pixels so the wrapper's scaled box lands on
     the element's edge rather than a hairline short of it. */
  function placeScreenUI() {
    if (!uiObject) return;

    const aspect = screenPlane.width / screenPlane.height;
    const outerW = SCREEN_UI.pixelsAcross;
    const outerH = Math.round(outerW / aspect);

    uiElement.style.width = outerW + 'px';
    uiElement.style.height = outerH + 'px';

    if (uiFit) {
      uiFit.style.width = Math.round(outerW / SCREEN_UI.uiScale) + 'px';
      uiFit.style.height = Math.round(outerH / SCREEN_UI.uiScale) + 'px';
      uiFit.style.transform = 'scale(' + SCREEN_UI.uiScale + ')';
    }

    uiObject.position.copy(screenPlane.centre);
    uiObject.quaternion.copy(screenQuaternion);
    uiObject.scale.setScalar(screenPlane.width / outerW);
    uiObject.visible = true;
    needsRender = true;
  }

  /* The power-on moment for the UI: one class, one opacity transition (the
     SCREEN UI block in style.css), and the element starts taking the
     pointer. Nothing else changes — same room, same laptop, same camera;
     only what is on the glass. */
  function wakeScreenUI() {
    if (uiAwake || !uiObject) return;
    uiAwake = true;
    uiElement.style.pointerEvents = 'auto';
    uiElement.classList.add('is-on');
  }

  /* The same beat undone. The element keeps its place on the panel — it was
     put there at load and is carried at opacity 0 the rest of the time — so
     all this changes is what is on the glass and whether the glass is taking
     the pointer. Handing the pointer back on the same frame the fade starts
     rather than at the end of it: a panel that is visibly dissolving but
     still answering clicks reads as broken, and the wheel has to reach the
     canvas again for the dolly to pick the shot back up. */
  function sleepScreenUI() {
    if (!uiAwake || !uiObject) return;
    uiAwake = false;
    uiElement.style.pointerEvents = 'none';
    uiElement.classList.remove('is-on');
  }

  /* Straight back along the panel's normal, at the distance that puts the
     panel across the frame. The lens stays square to the panel throughout
     (the orientation is screenQuaternion, not a look-at), so the panel — and
     the chat UI on it — arrives as a true rectangle.

     Aspect-dependent, so it is rerun on resize the same way the end of the
     dolly is: a window reshaped mid-move retargets rather than holding a
     framing measured for the old one. */
  function updateScreenViewPosition() {
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);

    /* The larger of the two is the distance that just contains the whole
       panel; FIT.fill then pushes in a hair past it. */
    const forHeight = (screenPlane.height * 0.5) / tanHalfFov;
    const forWidth = (screenPlane.width * 0.5) / (tanHalfFov * camera.aspect);
    const distance = Math.max(forHeight, forWidth) * FIT.fill;

    screenView
      .copy(screenPlane.centre)
      .addScaledVector(screenPlane.normal, distance);
  }

  /* The panel's own light, on the one material the traversal pre-wired for
     it. Same guard as setPowerGlow, for the same reason: once the value has
     settled there is nothing left to write. */
  function setScreenGlow(intensity) {
    const material = props.screenMaterial;
    if (!material) return;
    if (Math.abs(intensity - lastScreenGlow) < 0.001) return;
    lastScreenGlow = intensity;
    material.emissiveIntensity = intensity;
  }

  function updatePowerOn(dt) {
    /* One clock, signed. Everything below reads off `powerClock` alone — the
       camera, the aim, the backlight, the blur — so running it backwards is
       the whole of the power-off: the move retraces itself frame for frame
       instead of being a second animation that has to be kept in step with
       the first. Clamped at the far end so a parked loop cannot let the
       clock run away, and at zero because zero is the handback. */
    powerClock = THREE.MathUtils.clamp(powerClock + dt * powerDir, 0, PARK_AFTER);

    /* Position and aim on the same eased clock, so the panel is centred for
       the whole move and not only at the end of it. A straight line is the
       right path here: the two ends are within half a metre of each other,
       with nothing between them to swing around. */
    const move = easeMove(
      THREE.MathUtils.clamp(powerClock / POWER_ON.move, 0, 1)
    );
    camera.position.lerpVectors(pressPosition, screenView, move);

    /* Slerped from the aim the press was taken on to the panel's own basis,
       rather than look-at'd along the way. Look-at only guarantees the
       centre of the panel is in the middle of the frame; the last thing this
       move has to get right is that the lens is *square* to it, which is an
       orientation and not a target. Interpolating the orientation directly
       also keeps the arrival roll-free — the rake comes out of the picture
       smoothly over the move instead of never coming out at all. */
    camera.quaternion.copy(pressQuaternion).slerp(screenQuaternion, move);

    /* Still tracked, because the depth-of-field pass focuses on the distance
       from the lens to it. It no longer steers the camera. */
    cameraTarget.lerpVectors(pressTarget, screenPlane.centre, move);

    /* The strike. `rise` is the backlight coming up — fast, then easing into
       its resting value — and `kick` an overshoot laid over the first half of
       it, which is what makes it read as a flash rather than as a dimmer
       being turned up. */
    const x = THREE.MathUtils.clamp(powerClock / SCREEN.ramp, 0, 1);
    const rise = 1 - Math.pow(1 - x, 3);
    const kick = Math.sin(Math.PI * Math.min(x / SCREEN.flashSpan, 1));
    setScreenGlow(SCREEN.lit * rise + (SCREEN.flash - SCREEN.lit) * kick);

    /* The blur goes out with the move. By the time the panel owns the frame
       there is nothing behind it left to soften, and the chat UI is a DOM
       layer the pass could never blur anyway — a sharp interface over a
       soft panel would give the layering away. */
    dofFade = 1 - smoothstep(
      THREE.MathUtils.clamp((move - 0.35) / 0.65, 0, 1)
    );

    /* The UI comes up while the lens is still travelling, so the machine
       reads as booting as you lean in rather than switching on after you
       have arrived. Frame-driven off the same clock as the strike above
       rather than a setTimeout, so a backgrounded tab cannot land the fade
       before the move.

       Only on the way in. The way out starts its fade the moment the gesture
       lands (see startPowerOff) rather than waiting for the clock to fall
       back past this mark: the UI dissolving is what tells you the scroll
       was heard, and it has to answer immediately or the gesture reads as
       ignored. */
    if (powerDir > 0 && powerClock >= SCREEN_UI.wake) wakeScreenUI();

    if (powerDir > 0) {
      /* Announced for anything that wants to know the intro has landed —
         nothing in this codebase listens now that the UI lives in the scene,
         but it costs nothing and it is where a later phase would hook in. */
      if (!handedOff && powerClock >= Math.max(POWER_ON.move, SCREEN.ramp)) {
        handedOff = true;
        isPoweredOn = true;
        window.dispatchEvent(new CustomEvent('cine:screen-on'));
      }
      return;
    }

    /* Back at zero: the camera is sitting in exactly the frame the press was
       taken on, the panel is black and the UI has long since faded. Give the
       scroll its container back at the position it was frozen at, and the
       dolly picks the shot up from the same `dollyProgress` it was holding
       — so the next notch of wheel carries on reversing the walk-in instead
       of cutting to the wide shot. Everything the press set is unset here,
       which is what lets the whole sequence be played again. */
    if (powerClock > 0) return;

    powered = false;
    isPoweredOn = false;
    powerDir = 1;
    handedOff = false;
    pressFlash = 0;
    dofFade = 1;
    setScreenGlow(0);

    if (scroller) {
      scroller.style.overflowY = '';
      scroller.scrollTop = pressScrollTop;
    }

    /* The mirror of `cine:power`. Same promise: announced, never called. */
    window.dispatchEvent(new CustomEvent('cine:power-off'));
  }

  /* ---------------------------------------------------------------------
     PHASE 5, PART 3 — REVERSING OUT
     The press takes the camera off the scroll and locks the container, which
     leaves nothing for a scroll listener to read: the way back out has to be
     a gesture, caught before the page has had a chance to do anything with
     it. Hence a capture-phase listener on `window` rather than a `scroll`
     handler on #cineIntro — it sees the wheel whatever it is over, including
     the chat UI's own panels, which sit on a layer above the canvas and
     would otherwise swallow it whole.

     Swallowing it whole is exactly the bug this section fixes. The chat UI
     has two scrollable panels of its own — the message list and the history
     list — and while the pointer is over one of them the wheel is
     legitimately theirs. But only while they still have somewhere to go: at
     a panel's top edge the gesture stops being the list's and becomes the
     camera's, which is what makes "scroll up anywhere to get back out" true
     rather than true everywhere except over the one panel you happen to be
     reading.
     --------------------------------------------------------------------- */

  /* Does the chat UI itself want this gesture? Walks from whatever the event
     landed on up to #screenUI, looking for an ancestor that both scrolls and
     has room left in the direction asked for. The walk stops at #screenUI
     deliberately: #cineIntro above it is a scroll container too, and it is
     the one being stood in for here, not deferred to. */
  function chatWantsScroll(target, deltaY) {
    if (!uiElement || !uiAwake || !deltaY) return false;

    let node = target;
    if (node && node.nodeType === 3) node = node.parentElement;   // a text node
    if (!node || node.nodeType !== 1 || !uiElement.contains(node)) return false;

    while (node && node !== uiElement) {
      const overflowY = getComputedStyle(node).overflowY;
      const scrollable =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

      if (scrollable && node.scrollHeight - node.clientHeight > 1) {
        /* A pixel of slack at either end: sub-pixel layouts routinely leave a
           bottomed-out list a fraction short of its own maximum. */
        const room = deltaY < 0
          ? node.scrollTop > 1
          : node.scrollTop < node.scrollHeight - node.clientHeight - 1;
        if (room) return true;
      }

      node = node.parentElement;
    }

    return false;
  }

  let reverseAccum = 0;     // px of gesture built up toward the threshold
  let reverseLastAt = 0;    // when the last piece of it arrived

  /* Wheel deltas arrive in three units depending on the device and the
     browser. Normalised to pixels so the threshold means one thing. */
  function wheelPixels(event) {
    if (event.deltaMode === 1) return event.deltaY * 16;                    // lines
    if (event.deltaMode === 2) return event.deltaY * window.innerHeight;    // pages
    return event.deltaY;
  }

  /* Both input paths funnel through here: build the gesture, fire once it is
     unambiguous. Anything in the other direction throws the partial gesture
     away rather than letting it survive a change of mind. */
  function feedReverse(pixelsUp, threshold) {
    if (pixelsUp <= 0) { reverseAccum = 0; return false; }

    const now = performance.now();
    if (now - reverseLastAt > REVERSE.idleReset) reverseAccum = 0;
    reverseLastAt = now;

    reverseAccum += pixelsUp;
    if (reverseAccum < threshold) return false;

    startPowerOff();
    return true;
  }

  function onReverseWheel(event) {
    if (!isPoweredOn || powerDir < 0) return;

    const delta = wheelPixels(event);
    if (delta >= 0) { reverseAccum = 0; return; }
    if (chatWantsScroll(event.target, delta)) { reverseAccum = 0; return; }

    /* Consumed: there is nothing underneath this that should move. The
       scroller is locked, and the panel the pointer is over has already said
       it has nowhere left to go. */
    if (event.cancelable) event.preventDefault();
    feedReverse(-delta, REVERSE.wheel);
  }

  /* Touch, measured as travel rather than as a delta: a finger moving *down*
     the glass is content moving up, the same direction a negative wheel
     delta means. The target is taken from the touchstart and kept for the
     whole drag — a finger that slides off the message list mid-gesture
     should not change who the gesture belongs to. */
  let touchY = 0;
  let touchTarget = null;
  let touchTracking = false;

  function onReverseTouchStart(event) {
    touchTracking = false;
    if (!isPoweredOn || powerDir < 0 || event.touches.length !== 1) return;

    touchY = event.touches[0].clientY;
    touchTarget = event.target;
    reverseAccum = 0;
    touchTracking = true;
  }

  function onReverseTouchMove(event) {
    if (!touchTracking) return;
    if (!isPoweredOn || powerDir < 0 || event.touches.length !== 1) {
      touchTracking = false;
      return;
    }

    const y = event.touches[0].clientY;
    const travel = y - touchY;
    touchY = y;

    if (travel <= 0) { reverseAccum = 0; return; }
    if (chatWantsScroll(touchTarget, -travel)) { reverseAccum = 0; return; }

    if (event.cancelable) event.preventDefault();
    if (feedReverse(travel, REVERSE.touch)) touchTracking = false;
  }

  function onReverseTouchEnd() {
    touchTracking = false;
  }

  /* Capture phase on `window`: the chat UI is a DOM layer above the canvas,
     and this has to read the gesture before anything in it — or in the
     scroll container under it — gets a chance to act on it. `passive: false`
     because both handlers call preventDefault on the gestures they take. */
  const captureOpts = { capture: true, passive: false };
  window.addEventListener('wheel', onReverseWheel, captureOpts);
  window.addEventListener('touchstart', onReverseTouchStart, captureOpts);
  window.addEventListener('touchmove', onReverseTouchMove, captureOpts);
  window.addEventListener('touchend', onReverseTouchEnd, captureOpts);
  window.addEventListener('touchcancel', onReverseTouchEnd, captureOpts);

  /* Flips the one clock the power-on runs on. The camera, the backlight and
     the blur all retrace themselves from there (see updatePowerOn); the two
     things that are not on that clock are dealt with here. */
  function startPowerOff() {
    if (!powered || powerDir < 0) return;

    powerDir = -1;
    reverseAccum = 0;

    /* The clock is left parked a second past the end of the move so the
       render loop can tell "settled" from "still arriving". Reversing from
       there would spend that second holding a shot that has already been
       asked to leave, so it is wound back to the end of the move itself. */
    powerClock = Math.min(powerClock, POWER_ON.move);

    /* Back onto the panel mesh before anything moves: the flat placement is
       only right for a lens that is square to the panel, and the retreat
       leaves that on its first frame. */
    unflattenScreenUI();

    /* Immediately, rather than at the matching point on the way back down
       the clock: the fade is 650ms against a 1.15s retreat, so starting it
       now puts the glass dark well before the lens has finished pulling out
       — the screen switching off and *then* the camera leaving, instead of a
       chat UI riding the shot all the way back to the desk. It is also the
       acknowledgement that the gesture was heard. */
    sleepScreenUI();

    /* The loop parks itself once the panel has settled; there is a move on
       again now. */
    needsRender = true;
  }

  /* ---------------------------------------------------------------------
     FLAT SCREEN UI — the chat comes off the 3D pipeline once the lens lands
     While the camera is moving, the chat has to be a CSS3DObject: it is a
     plane in the room and it has to track the panel through the move. But
     once the move has settled the camera is exactly square to the panel (the
     orientation is screenQuaternion, the position is on the panel's normal),
     which means the panel is an axis-aligned rectangle on screen — and a
     rectangle needs no perspective to draw. So at that moment the element
     is lifted out of the renderer's camera element and placed with a plain
     2D translate + scale that lands on the same pixels the projection did.

     Why bother, if the picture is the same: because the chat is a live form,
     and a text input under a perspective() + matrix3d() inside a
     preserve-3d context is where browsers go wrong — hit-testing through
     the projection, caret and IME placement, focus scrolling the container,
     Firefox's handling of form controls in 3D contexts. A 2D transform has
     none of those problems. The element, its listeners and everything inside
     <main class="stage"> are untouched; only its parent and its transform
     change, and both are put back the moment the power-off starts.

     The renderer caches the last transform string it wrote per object and
     only rewrites on change, so the string is saved here and restored on the
     way back rather than cleared — cleared, it would stay cleared until the
     object itself moved. Removed from uiScene while flat so render() never
     visits it: it would set display and re-append the element to its own
     camera element.
     --------------------------------------------------------------------- */
  const flatSaved = { transform: '', transformOrigin: '', left: '', top: '' };
  let flatHome = null;      // the renderer's camera element, to go back into
  let flatStyle = '';       // the last 2D transform written, so a still frame writes nothing
  const flatCentre = new THREE.Vector3();

  function flattenScreenUI() {
    if (uiFlat || !uiObject || !uiLayer) return;
    uiFlat = true;

    flatHome = uiElement.parentNode;
    flatSaved.transform = uiElement.style.transform;
    flatSaved.transformOrigin = uiElement.style.transformOrigin;
    flatSaved.left = uiElement.style.left;
    flatSaved.top = uiElement.style.top;

    uiScene.remove(uiObject);

    /* Straight into the layer, as a sibling of the renderer's view element
       and after it, so it paints on top. The element is position:absolute
       (CSS3DObject sets that inline) and the layer is fixed, full-viewport:
       pinned at its origin, the transform below does the rest. */
    uiLayer.appendChild(uiElement);
    uiElement.style.left = '0';
    uiElement.style.top = '0';
    uiElement.style.transformOrigin = '0 0';
    flatStyle = '';
    layoutFlatScreenUI();
  }

  function unflattenScreenUI() {
    if (!uiFlat) return;
    uiFlat = false;

    uiElement.style.transform = flatSaved.transform;
    uiElement.style.transformOrigin = flatSaved.transformOrigin;
    uiElement.style.left = flatSaved.left;
    uiElement.style.top = flatSaved.top;
    if (flatHome) flatHome.appendChild(uiElement);

    uiScene.add(uiObject);
    needsRender = true;
  }

  /* The same projection the CSS3DRenderer does, reduced to the square-on
     case. Its perspective length is projectionMatrix[5] * height/2 in px,
     and a length x at distance d down the view axis lands at x * fov / d px
     from the frame's centre — so the element, which the object scales to
     the panel's width in metres, is drawn at that scale times fov / d. The
     centre is projected properly rather than assumed to be the frame's
     middle, so a lens a hair off the normal still lands where the panel is. */
  function layoutFlatScreenUI() {
    if (!uiFlat) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fovPx = camera.projectionMatrix.elements[5] * vh * 0.5;
    const distance = camera.position.distanceTo(screenPlane.centre);
    if (!(fovPx > 0) || !(distance > 0)) return;

    const scale = uiObject.scale.x * fovPx / distance;

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    flatCentre.copy(screenPlane.centre).project(camera);
    const cx = (flatCentre.x + 1) * 0.5 * vw;
    const cy = (1 - flatCentre.y) * 0.5 * vh;

    /* Origin at the element's top-left, so this reads right to left as:
       centre the box on its own origin, scale it there, carry it to the
       panel's centre on screen. */
    const style =
      'translate(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px) ' +
      'scale(' + scale.toFixed(5) + ') ' +
      'translate(-50%,-50%)';
    if (style === flatStyle) return;
    flatStyle = style;
    uiElement.style.transform = style;
  }

  /* Run once per drawn frame, after the renderers, so the camera matrices
     it reads are the ones the frame was drawn with. Flat exactly while the
     power-on clock is at or past the end of the move and running forward;
     anything else — the move in, the move out, the dolly — is the 3D case. */
  function syncFlatScreenUI() {
    const settled = powered && powerDir > 0 && powerClock >= POWER_ON.move;
    if (settled) {
      if (uiFlat) layoutFlatScreenUI();
      else flattenScreenUI();
    } else if (uiFlat) {
      unflattenScreenUI();
    }
  }

  /* ---------------------------------------------------------------------
     RENDER LOOP
     --------------------------------------------------------------------- */
  let lastFrame = performance.now();
  let frameHandle = 0;
  let needsRender = true;   // raised by anything that moves the picture while parked

  /* When the loop stops redrawing after the press. The move itself is
     POWER_ON.move; the press flash on the button and the backlight's strike
     have both settled well inside the second after it. */
  const PARK_AFTER = POWER_ON.move + 1.0;

  function frame(now) {
    /* Clamped: a backgrounded tab hands back a delta of several seconds on
       its first frame, which would otherwise snap the camera straight to
       wherever the scroll ended up while it was away. */
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    /* Parked. The camera is square on the lit panel and nothing in the room
       moves any more, so there is nothing to redraw — the chat UI is a DOM
       layer and repaints itself. Drawing a still room sixty times a second
       under it would cost a laptop its battery for no change on screen. The
       loop stays scheduled, at the price of one comparison a frame, so a
       resize (which raises needsRender) can wake it for a single pass.

       `powerDir > 0` is what keeps the park from swallowing the way out: a
       reversing clock is a move like any other, and startPowerOff raises
       needsRender for the one frame it takes to get back here. */
    if (powered && powerDir > 0 && powerClock >= PARK_AFTER && !needsRender) {
      frameHandle = requestAnimationFrame(frame);
      return;
    }
    needsRender = false;

    scrollProgress = readScroll();
    retireScrollCue(scrollProgress);

    if (powered) {
      /* The press takes the dolly out of the loop. The scroll is still read
         above so the cue logic stays whole, but nothing downstream of it
         touches the camera while the power-on move owns it — and because
         `dollyProgress` is left exactly where the press found it, the frame
         after the move has run back out is the frame the dolly was on. */
      updatePowerOn(dt);
    } else {
      /* Exponential damping, written frame-rate independently so the move
         takes the same wall-clock time to settle at 60Hz and at 144Hz. This
         is the whole reason the camera never jump-cuts: it chases the scroll
         rather than being assigned to it, so even a flung scrollbar arrives
         as a travelling shot. */
      dollyProgress += (scrollProgress - dollyProgress) *
        (1 - Math.exp(-SCROLL_DAMPING * dt));

      dollyT = smoothstep(dollyProgress);

      lensPath.getPoint(dollyT, camera.position);
      aimPath.getPoint(dollyT, cameraTarget);
      camera.lookAt(cameraTarget);
    }

    updatePowerCue(dollyT, dt, now * 0.001);
    updateDepthOfField(dollyT);

    if (composer) composer.render();
    else renderer.render(scene, camera);

    /* The DOM layer, from the same camera the frame above was drawn with —
       and after it, so the two can never be a frame apart. */
    css3d.render(uiScene, camera);

    /* After both renderers: the flat placement reads the camera the frame
       was just drawn with, and the settle frame is drawn once more by the
       CSS3D path before the element is lifted out of it. */
    syncFlatScreenUI();

    frameHandle = requestAnimationFrame(frame);
  }
  frameHandle = requestAnimationFrame(frame);

  /* ---------------------------------------------------------------------
     RESIZE
     `false` on setSize leaves the canvas's CSS size to the stylesheet, so the
     100vw/100dvh box stays authoritative and only the backing store changes.
     --------------------------------------------------------------------- */
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    /* The DOM layer has to stay the canvas's size to the pixel — its
       perspective origin is its centre, and the two pictures share one
       camera. No `false` here: the CSS size *is* what this renderer sets. */
    css3d.setSize(w, h);
    needsRender = true;

    /* The composer's targets are sized in device pixels, so they need the
       ratio as well as the CSS size; BokehPass picks up the new aspect for
       its blur kernel through the same call. */
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    }

    // Both closing shots are framed off the aspect ratio, so both move with
    // it. The power-on one only exists once the button has been pressed.
    updateEndPosition();
    if (powered) updateScreenViewPosition();
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ---------------------------------------------------------------------
     PHASE 6 — SETTLED
     There is no handoff, because there is nothing to hand off to: the chat
     UI's only home is the panel in this scene. Nothing is torn down and the
     context is kept — the room is what surrounds the screen for the rest of
     the session, and a resize has to be able to redraw it. What the old
     teardown was for, the cost of an idle render loop, is met by parking
     the loop instead (see RENDER LOOP above).
     --------------------------------------------------------------------- */

  window.__cineDebug = {
    scene,
    camera,
    props,
    THREE,
    screenPlane,
    uiObject,
    get armed() { return armed; },
    get powered() { return powered; },
    get poweredOn() { return isPoweredOn; },
    get reversing() { return powerDir < 0; },
    get awake() { return uiAwake; },
    get flat() { return uiFlat; }
  };
}
