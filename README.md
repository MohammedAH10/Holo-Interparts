# Holo-Interparts-3D
## Dev / Creator = MohammedAH10

Control exploded 3D models with your bare hands. Your webcam is the background, a hand skeleton and a gold ring follow your hand,
and each model is a glowing point cloud that pulls apart into labelled parts so you can see what is inside.

Hand tracking and rendering run in the browser with MediaPipe Hand Landmarker + Three.js/WebGL.
An optional local Node backend processes STL uploads, validates and simplifies the mesh, and
serves it back as a compact GLB that the browser draws as a glowing hologram surface.

## Run

Needs Node.js 18+ and Chrome or Edge.

```bash
cd holo-interparts-3d
npm install
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173) and click **Start camera**. Camera only works on `http://localhost` or `https`.
`npm install` copies the MediaPipe WASM and downloads the hand model into `public/`. If that download is blocked, the app fetches both from a CDN at runtime.

For STL uploads, saved models and backend processing, run the Node server in a second terminal:

```bash
npm run server
```

Or start both Vite and the backend together:

```bash
npm run dev:all
```

Vite proxies `/api` to `http://localhost:8787`. For a single production process:

```bash
npm run build
npm start
```

Then open http://localhost:8787. Runtime models are stored in `server/data/` and are ignored by git.

## STL backend

The backend is dependency-free Node.js and only accepts `.stl` files:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check and processing limits |
| `GET /api/models` | List saved models |
| `POST /api/models` | Multipart upload in the `file` field |
| `GET /api/models/:id` | Model metadata |
| `GET /api/models/:id/model.glb` | Processed GLB served to WebGL |
| `GET /api/models/:id/source.stl` | Original STL |
| `DELETE /api/models/:id` | Remove a saved model |

On upload the server detects binary or ASCII STL, rejects invalid/non-finite geometry, welds
vertices, removes degenerate and duplicate triangles, rebuilds normals, simplifies dense
meshes, computes bounds/centre and writes a self-contained GLB. Defaults: 60 MB upload and
250,000 triangles; override with `HOLO_MAX_UPLOAD` and `HOLO_MAX_TRIANGLES`.

If the backend is offline, STL files still import locally in the browser, just without
server-side validation, simplification or the saved library.

## Demo designs

Four designs are hardcoded and ship with the app, so you can try the whole exploded-view experience before
importing anything: **Turbofan Jet Engine**, **Radial Aircraft Engine**, **Sports Car** and **Human Brain**.

Click **Try demo designs** on the start screen (no camera needed — mouse controls are enabled) or use the
**Try a demo design** list in the left panel. The bottom chip bar switches between them too. When you are ready for
your own geometry, use **Import CAD** (`.stl`, `.obj`, `.ply`, `.gltf`, `.glb`, `.fbx`) or **Add part** to drop a
single part into the current design.

STL uploads go through the backend and appear in the **Saved models** list. You can click
**Import CAD** or drag a file straight onto the workspace. Imported CAD gets
a translucent WebGL hologram surface with a Fresnel rim, scanlines and glowing edges. The
surface fades into the point cloud as you explode the model; toggle it with the cube button
in the top-right toolbar. Use the small **×** in a saved row to delete it from the library.

## Models

Turbofan Jet Engine (fan, guide vanes, compressors, combustor, turbines, shaft, nozzle) ·
Radial Aircraft Engine (crankcase, 9 cylinders, pistons, rods, crankshaft, exhaust ring, supercharger) ·
Sports Car (body panels, chassis, engine, drivetrain, seats, wheels, brakes) ·
Human Brain (4 lobes, cerebellum, brainstem, corpus callosum, thalamus, hippocampus, amygdala, hypothalamus)

## Hand control or mouse control

You are never locked into one input. Use **Start camera** for hand gestures or **Use mouse instead** / **Try demo designs**
for mouse control, and switch whenever you like with the **Switch to hand gestures / Switch to mouse control** button in
the left panel. Switching to mouse stops the webcam track (the camera light turns off); switching back asks for the camera
again. Mouse drag/zoom/click keep working while hand gestures are on.

## Gestures

| Gesture | Effect |
|---|---|
|---|---|
| Open hand slowly | Explode the model. The white arc on the gold ring shows how far. |
| Close your hand / fist | Pull it back together |
| Move or twist your hand | Rotate and tilt the model |
| Point (index finger) | Highlight the part under your fingertip. Hold still to lock it. |
| Pinch while over a part | Grab it, drag it out, release to snap it back |
| Two hands | Move them apart or together to zoom |
| Peace sign (hold ~0.3 s) | Jump to the next model |

## Mouse and keyboard

Drag = rotate · scroll = zoom · click a part = inspect it · `Space` = explode / assemble · `←` `→` or `1`–`4` = switch model · `R` = reset view.
Sliders in the left panel control the explosion and its intensity. The top-right buttons toggle camera background, hand skeleton, labels and fullscreen.

## Full view (retractable controls)

The left panel and the top-right toolbar cover part of the model. Click the small tab on the left edge or press
`H` to retract them; the model recenters, labels use the full width, and only a slim handle stays on screen.
Click the tab again (or press `H`) to bring the controls back. The choice is remembered between visits.

## Tips

- Even light and a plain background help. Keep your hand 40–80 cm from the camera, palm facing it.
- Open and close your hand slowly. The peace sign needs a short hold so it does not trigger by accident.

## Files

```
src/main.js               app loop, hand overlay, gesture -> action, labels, UI, backend import
src/handTracking.js       MediaPipe wrapper (2 hands, local files then CDN, GPU then CPU)
src/gestureEngine.js      landmarks -> gesture, openness, smoothed palm / fingertip / pinch, wrist roll
src/scene.js              Three.js point-cloud renderer: explode, scatter transition, picking, part dragging
src/scene/hologram.js     WebGL hologram shader and glowing edge surface
src/import/modelFactory.js CAD object -> point cloud + hologram surface model definition
src/api/models.js         backend health, upload progress, saved list and GLB loading
src/models/               shapes.js (point sampling) + jet / radial / car / brain definitions
server/index.mjs          Node HTTP server entry point
server/app.mjs            REST routes and upload handling
server/stl.mjs            binary / ASCII STL parser
server/mesh.mjs           weld, repair, simplify and centre meshes
server/glb.mjs            dependency-free GLB writer
server/store.mjs          saved model storage under server/data/
test/                     node:test parser, mesh, GLB and API tests
```

To add a model: write a `build()` returning parts (`P(name, description, color, [I(cloud, explodeDirection)])`) and register it in `src/models/index.js`.
