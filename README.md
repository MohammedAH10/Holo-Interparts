# Holo-Interparts-3D
## Dev / Creator = MohammedAH10

Import CAD parts, assemble them with your bare hands, and lock them together. Your webcam is the background,
a hand skeleton and a gold ring follow your hand, and imported parts render as solid lit CAD meshes with glowing
edges. Labels stay visible while you work, and every part title can be edited in the part card.

Hand tracking and rendering run in the browser with MediaPipe Hand Landmarker + Three.js/WebGL.
An optional local Node backend processes STL uploads, validates and simplifies the mesh, and
serves it back as a compact GLB that the browser draws as a solid CAD surface.

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

## Importing parts

- **Import CAD** accepts one or more `.stl`, `.obj`, `.ply`, `.gltf`, `.glb` or `.fbx` files.
- One file opens as a single solid part. Several files become a scattered assembly you can move together.
- **Add parts** appends one or more files to the current model, up to the shader limit of 24 parts.
- Drag files onto the workspace too: one file opens it, several build an assembly.
- A single `.stl` import still uses the backend and appears in **Saved models**. Multi-file imports and
  non-STL files are processed locally in the browser.
- Solid models show their labels immediately. Select a part and edit its title directly in the part card.
- Use the cube button in the top-right toolbar to switch between the solid surface and the point cloud.

## Assembly gestures

Pinch a part to grab it. It stays where you release it. Drag it near another part, then make a fist to lock the
two groups together. Locked parts move as one and are joined by a glowing link. Use **Unlink parts** or press
`U` to release every group.

| Gesture | Effect |
|---|---|
| Open hand / move | Rotate and tilt the assembly |
| Fist | Lock the touched or selected part to its nearest neighbour |
| Point (index finger) | Highlight the part under your fingertip; hold still to select it |
| Pinch while over a part | Grab and drag it into place |
| Two hands | Move them apart or together to zoom |
| Peace sign (hold ~0.3 s) | Jump to the next model |

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

Four point-cloud designs are hardcoded and ship with the app: **Turbofan Jet Engine**, **Radial Aircraft Engine**,
**Sports Car** and **Human Brain**. Click **Try demo designs** on the start screen (no camera needed — mouse
controls are enabled) or use the **Try a demo design** list in the left panel. Import your own CAD to work with
solid, linkable parts.

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

## Mouse and keyboard

Drag = rotate · scroll = zoom · click a part = inspect it · `U` = unlink parts · `←` `→` or `1`–`4` = switch model ·
`R` = reset view. The top-right buttons toggle camera background, hand skeleton, labels, solid surface and fullscreen.

## Full view (retractable controls)

The left panel and the top-right toolbar cover part of the model. Click the small tab on the left edge or press
`H` to retract them; the model recenters, labels use the full width, and only a slim handle stays on screen.
Click the tab again (or press `H`) to bring the controls back. The choice is remembered between visits.

## Tips

- Even light and a plain background help. Keep your hand 40–80 cm from the camera, palm facing it.
- Pinch, drag close to another part, then make a fist to link them.
- The peace sign needs a short hold so it does not trigger by accident.

## Files

```
src/main.js               app loop, hand overlay, gesture -> action, labels, UI, backend import
src/handTracking.js       MediaPipe wrapper (2 hands, local files then CDN, GPU then CPU)
src/gestureEngine.js      landmarks -> gesture, openness, smoothed palm / fingertip / pinch, wrist roll
src/scene.js              Three.js renderer: solid parts, point clouds, picking, dragging, part groups
src/scene/solidParts.js   lit CAD meshes with glowing edge overlays and hover highlights
src/assembly/groups.js    pure part-link group helpers
src/import/modelFactory.js CAD object -> point cloud + solid surface model definition
src/import/assemblyModel.js multi-file CAD imports -> assembly model definition
src/editing/addPart.js    load a CAD file, align it to a pack, return a part + cloud + surface
src/api/models.js         backend health, upload progress, saved list and GLB loading
src/models/               shapes.js (point sampling) + jet / radial / car / brain definitions
server/index.mjs          Node HTTP server entry point
server/app.mjs            REST routes and upload handling
server/stl.mjs            binary / ASCII STL parser
server/mesh.mjs           weld, repair, simplify and centre meshes
server/glb.mjs            dependency-free GLB writer
server/store.mjs          saved model storage under server/data/
test/                     node:test parser, mesh, GLB, API and assembly tests
```

To add a demo: write a `build()` returning parts (`P(name, description, color, [I(cloud)])`) and register it in
`src/models/index.js`. Imported CAD is the recommended path for real assemblies.
