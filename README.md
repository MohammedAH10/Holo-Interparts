# Holo-Interparts-3D
## Dev / Creator = MohammedAH10

Control exploded 3D models with your bare hands. Your webcam is the background, a hand skeleton and a gold ring follow your hand,
and each model is a glowing point cloud that pulls apart into labelled parts so you can see what is inside.

Everything runs in the browser: MediaPipe Hand Landmarker + Three.js. No backend, no API keys, nothing is uploaded.

## Run

Needs Node.js 18+ and Chrome or Edge.

```bash
cd holo-interparts-3d
npm install
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173) and click **Start camera**. Camera only works on `http://localhost` or `https`.
`npm install` copies the MediaPipe WASM and downloads the hand model into `public/`. If that download is blocked, the app fetches both from a CDN at runtime.

## Demo designs

Four designs are hardcoded and ship with the app, so you can try the whole exploded-view experience before
importing anything: **Turbofan Jet Engine**, **Radial Aircraft Engine**, **Sports Car** and **Human Brain**.

Click **Try demo designs** on the start screen (no camera needed — mouse controls are enabled) or use the
**Try a demo design** list in the left panel. The bottom chip bar switches between them too. When you are ready for
your own geometry, use **Import CAD** (`.stl`, `.obj`, `.ply`, `.gltf`, `.glb`, `.fbx`) or **Add part** to drop a
single part into the current design.

## Models

Turbofan Jet Engine (fan, guide vanes, compressors, combustor, turbines, shaft, nozzle) ·
Radial Aircraft Engine (crankcase, 9 cylinders, pistons, rods, crankshaft, exhaust ring, supercharger) ·
Sports Car (body panels, chassis, engine, drivetrain, seats, wheels, brakes) ·
Human Brain (4 lobes, cerebellum, brainstem, corpus callosum, thalamus, hippocampus, amygdala, hypothalamus)

## Gestures

| Gesture | Effect |
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
src/main.js          app loop, hand overlay, gesture -> action, labels, UI
src/handTracking.js  MediaPipe wrapper (2 hands, local files then CDN, GPU then CPU)
src/gestureEngine.js landmarks -> gesture, openness, smoothed palm / fingertip / pinch, wrist roll
src/scene.js         Three.js point-cloud renderer: explode, scatter transition, picking, part dragging
src/models/          shapes.js (point sampling) + jet / radial / car / brain definitions
```

To add a model: write a `build()` returning parts (`P(name, description, color, [I(cloud, explodeDirection)])`) and register it in `src/models/index.js`.
