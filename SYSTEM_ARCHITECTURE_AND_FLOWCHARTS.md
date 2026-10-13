# System Architecture & Flowcharts

> Architecture and end-to-end flows for **CAD → Interactive Hologram**: importing designs
> from CAD / 3D tools, compiling them into labelled exploded point clouds, interacting
> with them by hand, and adding new parts to an existing design.

Companion to [`CAD_IMPORT_BUILD_GUIDE.md`](./CAD_IMPORT_BUILD_GUIDE.md) (the code).
All diagrams are [Mermaid](https://mermaid.js.org/) — they render on GitHub, GitLab and
most Markdown viewers.

---

## Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [System context](#2-system-context)
3. [Component architecture](#3-component-architecture)
4. [Layered view (compile-time vs run-time)](#4-layered-view-compile-time-vs-run-time)
5. [Data model (ERD)](#5-data-model-erd)
6. [Compile pipeline flowchart](#6-compile-pipeline-flowchart)
7. [Runtime frame loop](#7-runtime-frame-loop)
8. [Gesture state machine](#8-gesture-state-machine)
9. [Interaction sequence — point & inspect](#9-interaction-sequence--point--inspect)
10. [Interaction sequence — pinch, grab, drag](#10-interaction-sequence--pinch-grab-drag)
11. [Add-new-part flow (runtime)](#11-add-new-part-flow-runtime)
12. [Add-new-part flow (build-time)](#12-add-new-part-flow-build-time)
13. [Labels & descriptions resolution](#13-labels--descriptions-resolution)
14. [Build & deploy flow](#14-build--deploy-flow)
15. [Design decisions & rationale](#15-design-decisions--rationale)
16. [Performance budget](#16-performance-budget)
17. [Reuse map from HoloHand](#17-reuse-map-from-holohand)

---

## 1. Architecture at a glance

The system has **two distinct phases**, connected only by a static file format (the
**model pack**):

- **Compile time** (offline, Node CLI or browser compiler page): CAD/3D file → model pack.
- **Run time** (browser): model pack → interactive point cloud.

This separation is the backbone of the whole design. The compiler can be slow, run once,
and use heavy loaders. The runtime stays lean: it only ever reads a binary
`Float32Array` of positions plus a small JSON header.

```mermaid
flowchart LR
    subgraph Authoring["Compile time (offline)"]
        CAD[("CAD / 3D file<br/>STL OBJ GLTF GLB FBX PLY")]
        MAN[("design manifest<br/>*.design.json")]
        LAB[("labels.json")]
        COMP[[Compiler]]
        PACK[("model pack<br/>*.holo.json + *.holo.bin")]
    end

    subgraph Runtime["Run time (browser)"]
        LOADER[[Pack loader]]
        SCENE[[HoloScene<br/>point-cloud renderer]]
        GEST[[Gesture engine]]
        TRACK[[Hand tracker]]
        CAM[(Webcam)]
        UI[[UI + label overlay]]
    end

    CAD --> COMP
    MAN --> COMP
    LAB --> COMP
    COMP --> PACK
    PACK --> LOADER
    LOADER --> SCENE
    CAM --> TRACK --> GEST --> SCENE
    SCENE --> UI
    GEST --> UI
```

---

## 2. System context

Who and what the app talks to. There is deliberately **no backend** for the core flow.

```mermaid
flowchart TB
    User([User]):::actor
    Designer([Designer / Engineer]):::actor

    subgraph Browser["Browser (client-only, no upload)"]
        App[HoloForge SPA]
        Cam[(Webcam)]
        Storage[(IndexedDB / downloads)]
    end

    subgraph Offline["Offline / build machine"]
        CADTool[CAD & 3D authoring tools]
        CLI[Node compile CLI]
    end

    CDN[["MediaPipe CDN<br/>(wasm + hand model fallback)"]]

    Designer -->|authors assembly| CADTool
    CADTool -->|STL/OBJ/GLTF/GLB/FBX/PLY| CLI
    CLI -->|compiled packs| App

    User -->|hand gestures, mouse| App
    Cam -->|video frames| App
    App <-->|pack additions| Storage
    App -.->|only if local wasm/model missing| CDN

    classDef actor fill:#f2c94c,color:#1b1704,stroke:#b8932f;
```

Key context facts:

- The webcam feed **never leaves the browser**; hand landmarks are computed locally.
- The only optional network calls are the MediaPipe WASM/model fallbacks.
- "Packs" are the contract between the offline pipeline and the app.

---

## 3. Component architecture

How the modules depend on each other. The runtime (`scene`, `tracking`, `ui`, `main`) is
decoupled from the compiler (`import`, `compile`). They share only the **pack format**.

```mermaid
flowchart TB
    subgraph entry["Entry"]
        HTML[index.html · compiler.html]
        MAIN[main.js]
        CPage[compile/compilerPage.js]
    end

    subgraph runtime["Runtime (browser)"]
        HS[scene/HoloScene.js]
        SH[scene/shaders.js]
        PL[scene/packLoader.js]
        REG[labels/registry.js]
        OVL[ui/overlay.js]
    end

    subgraph tracking["Perception"]
        HT[tracking/handTracking.js]
        GE[tracking/gestureEngine.js]
        UT[utils.js]
    end

    subgraph compile["Compile pipeline"]
        LD[import/loaders.js]
        AS[import/assembly.js]
        SA[import/sampler.js]
        CO[compile/compiler.js]
        CL[compile/colors.js]
        EX[compile/explode.js]
        PW[compile/packWriter.js]
        CLI[scripts/compile.mjs]
    end

    subgraph editing["Editing"]
        AP[editing/addPart.js]
        MF[editing/manifest.js]
    end

    MAIN --> HS
    MAIN --> PL
    MAIN --> HT
    MAIN --> GE
    MAIN --> REG
    MAIN --> AP
    MAIN --> OVL
    HS --> SH
    PL --> REG
    GE --> UT
    AP --> LD
    AP --> AS
    AP --> SA
    AP --> EX
    AP --> CL

    CPage --> LD
    CPage --> CO
    CPage --> PW
    CPage --> REG

    CO --> AS
    CO --> SA
    CO --> CL
    CO --> EX
    LD --> AS
    CLI --> LD
    CLI --> CO
    CLI --> REG
    MF -.-> CO
```

Notice: `import/*` and `compile/*` are **isomorphic** (no DOM APIs except in
`loaders.js`'s browser path and `packWriter.js`), so the same code runs in the Node CLI,
the browser compiler page, and the runtime's runtime-add path.

---

## 4. Layered view (compile-time vs run-time)

```mermaid
flowchart TB
    subgraph L1["1 · Source"]
        A1[CAD export file]
        A2[manifest JSON]
        A3[labels JSON]
    end
    subgraph L2["2 · Import"]
        B1[loader by extension]
        B2[flatten assembly tree]
        B3[group meshes into parts]
    end
    subgraph L3["3 · Sample"]
        C1[triangle area CDF]
        C2[area-weighted surface points]
        C3[recentre on assembly bounds]
    end
    subgraph L4["4 · Enrich"]
        D1[part name + pretty label]
        D2[colour: material / rule / hash]
        D3[anchor + explode direction]
        D4[description from labels/manifest]
    end
    subgraph L5["5 · Pack"]
        E1[*.holo.json metadata]
        E2[*.holo.bin Float32 positions]
        E3[index.json]
    end
    subgraph L6["6 · Runtime"]
        F1[fetch + typed-array views]
        F2[BufferGeometry attributes]
        F3[shader render]
        F4[gesture + label overlay]
    end
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
```

---

## 5. Data model (ERD)

```mermaid
erDiagram
    DESIGN ||--o{ PART_RULE : "defines"
    DESIGN ||--o{ LABEL_OVERRIDE : "overrides"
    DESIGN ||--|| SOURCE : "compiled from"
    DESIGN ||--|| PACK : "produces"
    PACK ||--|{ PART : "contains"
    PART ||--|| CLOUD : "samples"
    PART_RULE ||--o{ PART : "matches by glob"

    DESIGN {
        string id PK
        string name
        string category
        string subtitle
        object view
        string explodeMode
        float explodeScale
        string_array exclude
    }
    SOURCE {
        string file
    }
    PART_RULE {
        string mesh_glob
        string color
        string desc
        float explodeScale
        float density
    }
    LABEL_OVERRIDE {
        string cad_id PK
        string label
        string desc
        string color
    }
    PACK {
        int version
        string id
        string binName
        float3 origin
        float radius
    }
    PART {
        string name
        string label
        string desc
        string color
        float3 anchor
        float3 dir
        int byteOffset
        int byteLength
        int count
    }
    CLOUD {
        float32_array xyz
    }
```

Relationship notes:

- A **`PART_RULE`** (manifest) matches zero-or-more raw CAD meshes by glob; matched meshes
  become one `PART`.
- A **`LABEL_OVERRIDE`** (labels.json) targets a raw CAD id (`name` or `re:regex`) and
  wins over the manifest when the loader resolves labels.
- A `PART` owns exactly one `CLOUD` (after merging all matched meshes).
- `origin` and `radius` live on the `PACK` so parts added later can align to the same
  space and explode by the same scale.

---

## 6. Compile pipeline flowchart

```mermaid
flowchart TD
    S([Start: compileDesign]) --> V{Manifest valid?}
    V -- no --> ERR1[/Return validation errors/]
    V -- yes --> LOAD[Load source file by extension]
    LOAD --> OK{Load OK?}
    OK -- no --> ERR2[/Throw 'unsupported / parse fail'/]
    OK -- yes --> FLAT[flattenAssembly: walk tree, world matrices]
    FLAT --> EXC[Drop meshes matching 'exclude' globs]
    EXC --> GRP[Group meshes by part name]
    GRP --> FIL{Manifest lists parts?}
    FIL -- yes --> KEEP[Keep only meshes claimed by a rule]
    FIL -- no --> ALLKEEP[Keep all groups]
    KEEP --> ANY
    ALLKEEP --> ANY{Any groups left?}
    ANY -- no --> ERR3[/Throw 'no meshes matched'/]
    ANY -- yes --> BOUND[Compute bounds: center + radius]
    BOUND --> AREA[Measure per-mesh surface area]
    AREA --> BUD[Global point budget scale = min 1, maxPoints / totalArea]
    BUD --> LOOP[For each part group]
    LOOP --> RULE{Match a part rule?}
    RULE -- yes --> USE[Use rule color/desc/explode/density]
    RULE -- no --> AUTO[Auto colour + pretty name + default explode]
    USE --> SAMP
    AUTO --> SAMP[For each mesh: area-weighted sample, split budget]
    SAMP --> REC[Recentre cloud on assembly center]
    REC --> LAB[Resolve label via registry]
    LAB --> EXP[deriveExplode anchor + radius]
    EXP --> PUSH[Push part + cloud chunk]
    PUSH --> MORE{More groups?}
    MORE -- yes --> LOOP
    MORE -- no --> LIM{parts <= MAXP 24?}
    LIM -- no --> ERR4[/Throw 'too many parts'/]
    LIM -- yes --> OFFS[Assign byteOffset / byteLength]
    OFFS --> SER[Serialize JSON meta + concat Float32 bin]
    SER --> OUT([Return meta + binBuffer])
```

Decision points to watch:

- **Format check** happens in the loader (extension dispatch).
- **`MAXP = 24`** is a hard ceiling set by the shader's `uOff[24]` uniform array.
- **Budget scaling** keeps total points under `maxPoints` regardless of CAD complexity.

---

## 7. Runtime frame loop

Every animation frame, in order. This is HoloHand's loop with the model source swapped.

```mermaid
flowchart TD
    START([requestAnimationFrame]) --> DT[Compute dt, clamp]
    DT --> NEWFRAME{New video frame?}
    NEWFRAME -- yes --> DET[HandTracker.detect video]
    DET --> UPD[GestureEngine.update landmarks]
    NEWFRAME -- no --> CTRL
    UPD --> CTRL[control t, dt: gesture to action]
    CTRL --> HANDS{Hands present?}
    HANDS -- 0 --> IDLE[Release grab, clear hover]
    HANDS -- 1 --> ONE{Which gesture?}
    HANDS -- 2 --> ZOOM[Palm distance to zoom]
    ONE -- OPEN --> EXPL[Openness drives explode target]
    ONE -- FIST --> ASSEM[Explode target = 0]
    ONE -- POINT --> PICK[pick part under tip, dwell to select]
    ONE -- PINCH --> GRAB[Grab / drag part]
    ONE -- PEACE --> NEXT[next model]
    IDLE --> SYNC
    EXPL --> SYNC[Sync sliders + button labels]
    ASSEM --> SYNC
    PICK --> SYNC
    GRAB --> SYNC
    NEXT --> SYNC
    ZOOM --> SYNC
    SYNC --> SU[scene.update dt,t: damp explode/scale/scatter, rotate, render]
    SU --> OVL[drawOverlay: labels, skeleton, rings]
    OVL --> START
```

The renderer's `update()` responsibilities:

1. Damp `explode → explodeTarget`, `scale → scaleTarget`, `scatter → scatterTarget`.
2. When scattering between models completes, load the pending pack.
3. Apply inertia / auto-spin when the user is not steering.
4. Lerp per-part drag offsets (`uOff`) back to zero on release.
5. Update shader uniforms and render.

---

## 8. Gesture state machine

Per hand, the gesture engine emits a **stable** gesture after a short streak, so brief
misclassifications don't fire actions. This is the HoloHand state machine, reused.

```mermaid
stateDiagram-v2
    [*] --> NONE
    NONE --> OPEN : 4 fingers extended
    NONE --> FIST : 4 fingers curled
    NONE --> POINT : index only
    NONE --> PEACE : index+middle (hold ~8 frames)
    NONE --> PINCH : thumb-index distance < 0.32 (needs 2 frames)

    OPEN --> FIST
    OPEN --> POINT
    OPEN --> PEACE
    OPEN --> PINCH
    FIST --> OPEN
    FIST --> POINT
    POINT --> PINCH
    POINT --> FIST
    POINT --> OPEN
    PEACE --> OPEN
    PEACE --> FIST
    PINCH --> OPEN
    PINCH --> POINT
    PINCH --> FIST

    note right of PINCH
        Hysteresis: enter < 0.32,
        exit > 0.5 or index no longer up.
    end note
    note right of PEACE
        Requires streak >= 8 and a
        cooldown before re-triggering.
    end note
```

Mapping to actions (from `main.js`):

| Gesture | Action | Renderer call |
|---|---|---|
| `OPEN` | Explode by openness | `scene.explodeTarget = openness` |
| `FIST` | Assemble | `scene.explodeTarget = 0` |
| `NONE` + move | Rotate / tilt | `scene.rotateBy`, `scene.rollBy` |
| `POINT` | Hover, dwell → select | `scene.pick`, `scene.setHover`, `scene.setSel` |
| `PINCH` | Grab / drag part | `scene.dragPart`, `scene.releaseAll` |
| `PEACE` | Next model | `scene.next` |
| two hands | Zoom | `scene.scaleTarget` |

---

## 9. Interaction sequence — point & inspect

```mermaid
sequenceDiagram
    actor U as User
    participant CAM as Webcam
    participant HT as HandTracker
    participant GE as GestureEngine
    participant M as main.control()
    participant S as HoloScene
    participant O as Overlay

    U->>CAM: points index finger at a part
    CAM->>HT: video frame
    HT->>GE: 21 landmarks
    GE->>M: { gesture: POINT, tip: {x,y} }
    M->>S: pick(tip.x*W, tip.y*H, 95)
    S-->>M: partIndex
    M->>S: setHover(partIndex)
    M->>O: showPart(partIndex)  (name + description)
    loop dwell >= 0.7 s
        M->>M: accumulate dwell timer
    end
    M->>S: setSel(partIndex)  (lock highlight)
    S-->>O: labelPoints() -> anchored labels drawn
```

---

## 10. Interaction sequence — pinch, grab, drag

```mermaid
sequenceDiagram
    actor U as User
    participant GE as GestureEngine
    participant M as main.control()
    participant S as HoloScene

    U->>GE: thumb + index touch (PINCH)
    M->>S: pick(pinchPt, 170)
    alt part found (or recent hover)
        M->>S: setSel(idx); setHover(idx)
        M->>M: grab = { part, last }
    end
    loop while pinching and moving
        U->>GE: hand moves
        M->>S: dragPart(idx, dx, dy)
        S->>S: offT[idx] += pixel delta to world
    end
    U->>GE: opens hand (no longer PINCH)
    M->>S: releaseAll()
    S->>S: lerp uOff[idx] back to (0,0,0)
```

The dragged offset lives in `HoloScene.offT[]`; the shader reads the smoothed `uOff[]`
so the part eases back into place when released.

---

## 11. Add-new-part flow (runtime)

```mermaid
flowchart TD
    A([User clicks Add part]) --> B[File picker: stl/obj/ply/glb/gltf/fbx]
    B --> C[loadModelFile -> Object3D]
    C --> D[flattenAssembly]
    D --> E{Meshes found?}
    E -- no --> ERR[/Toast: could not add part/]
    E -- yes --> F{align to pack.origin?}
    F -- yes --> G[subtract stored origin]
    F -- no --> H[subtract this file's own center]
    G --> I[area-weighted sample all meshes]
    H --> I
    I --> J[centroid -> anchor]
    J --> K[deriveExplode anchor + pack.radius]
    K --> L[build part {label, color, dir, anchor}]
    L --> M[scene.appendPart part, cloud]
    M --> N[push into model.build() array]
    N --> O[delete geometry cache, rebuild BufferGeometry]
    O --> P[swap geometry on existing Points]
    P --> Q[releaseAll + onModel refresh UI]
    Q --> R([Part visible + labelled])
    R --> S{Persist?}
    S -- download --> T[serializeCurrentModel -> downloadPack]
    S -- dev server --> U[savePackToDevServer -> public/packs]
    S -- no --> V([In-memory only])
```

Constraint: runtime addition is limited to **24 total parts** per model, because the
shader's `uOff[24]` array is fixed at compile of the shader source. Raising it means
editing `shaders.js` and recompiling all packs consistently.

---

## 12. Add-new-part flow (build-time)

```mermaid
flowchart LR
    A[Edit designs/id.design.json] --> B{Add a rule or a new source?}
    B -- rule --> C["{ mesh: 'NewBracket*', color, desc }"]
    B -- new source --> D["{ mesh: 'Pump', source: 'assets/pump.stl' }"]
    C --> E[npm run compile -- designs/id.design.json]
    D --> E
    E --> F[CLI: load, compile, write pack]
    F --> G[Refresh public/packs/index.json]
    G --> H[Reload app]
    H --> I([New part present, labelled, explodes with assembly])
```

---

## 13. Labels & descriptions resolution

```mermaid
flowchart TD
    A([Raw CAD part name]) --> B{labels.json exact match?}
    B -- yes --> L1[Use override label/desc/color]
    B -- no --> C{labels.json re: regex match?}
    C -- yes --> L2[Use override label/desc/color]
    C -- no --> D{Pack has label/desc?}
    D -- yes --> L3[Use compiled label/desc + manifest color]
    D -- no --> E[prettyName raw name]
    L1 --> OUT([Final part card + label])
    L2 --> OUT
    L3 --> OUT
    E --> OUT
```

Resolution happens in `packLoader.packToModel` (and again for runtime-added parts).
That means **editing `labels.json` does not require recompiling packs** — a deliberate
choice so documentation and naming can be iterated quickly.

---

## 14. Build & deploy flow

```mermaid
flowchart TD
    A([npm install]) --> B[postinstall: setup.mjs]
    B --> B1[copy MediaPipe wasm -> public/wasm]
    B --> B2[download hand model -> public/models]
    B2 --> C{Author designs}
    C --> D[npm run compile -- designs/id.design.json]
    D --> E[packs in public/packs + index.json]
    E --> F[npm run build -> dist/]
    F --> G[Deploy dist/ to static host]
    G --> H([Served over https / localhost])
    B2 -.->|download blocked| X[Runtime CDN fallback]
    X --> H
```

---

## 15. Design decisions & rationale

| Decision | Why |
|---|---|
| **Point clouds, not textured meshes** | Matches HoloHand's aesthetic, gives a uniform "holographic" look across arbitrary CAD sources, and makes picking/labels trivial (anchors are just points). |
| **Pack file = JSON + raw Float32 bin** | Metadata stays readable/diffable; the hot data path is a zero-copy typed-array view. |
| **Area-weighted surface sampling** | Uniform visual density independent of the CAD tessellation (a huge flat face and a tiny one get comparable point spacing). |
| **Compile-time vs run-time split** | Heavy loaders never ship to the runtime; the runtime stays fast and small. |
| **Compiler is isomorphic** | Same `compile/*` and `import/*` code powers the Node CLI, browser compiler page, and runtime-add. One implementation, three entry points. |
| **Labels resolved at load, not compile** | Rename/describe parts without recompiling; keep docs decoupled from geometry. |
| **Reuse HoloHand's renderer & gestures** | The renderer/interaction contract is proven; only the model source changes. |
| **`MAXP = 24` fixed** | Keeps the shader's uniform array static (WebGL-friendly). Appending is allowed up to the cap. |
| **Radial explode by default** | Best generic "exploded diagram" behaviour for arbitrary assemblies; `axial` + per-part overrides cover the rest. |

---

## 16. Performance budget

| Stage | Target | Notes |
|---|---|---|
| Compile (CLI) | < 8 s for 100k-triangle assembly | Sampling dominates; totally offline. |
| Pack size | ≤ 60k points → ~720 KB `.bin` | `maxPoints` budget; tune per device. |
| Runtime load | < 300 ms per pack | Fetch + `new Float32Array(view)`; no parsing. |
| Frame | 60 fps with 2 hands + 24 parts | One draw call for all points; additive blending. |
| Hand tracking | ~30–60 fps | MediaPipe GPU delegate when available. |
| Overlay | < 2 ms | 2D canvas labels + skeleton. |

Points are the dominant cost. If frame time rises, lower `maxPoints`/`pointsPerUnit` or
compile an LOD pack.

---

## 17. Reuse map from HoloHand

```mermaid
flowchart LR
    subgraph HH["HoloHand (reference)"]
        HT[handTracking.js]
        GE[gestureEngine.js]
        SC[scene.js]
        UT[utils.js]
        CSS[styles.css]
        MI[main.js]
    end
    subgraph HF["HoloForge (this project)"]
        HT2[tracking/handTracking.js]
        GE2[tracking/gestureEngine.js]
        SC2[scene/HoloScene.js +appendPart]
        UT2[utils.js]
        CSS2[styles.css]
        MI2[main.js adapted]
        NEW["import/* · compile/* · labels/* · editing/* · scripts/compile.mjs"]
    end
    HT -->|verbatim| HT2
    GE -->|verbatim| GE2
    SC -->|plus 2 methods| SC2
    UT -->|verbatim| UT2
    CSS -->|plus UI| CSS2
    MI -->|source swap + 2 hooks| MI2
    HH -.->|replaced| NEW
```

Reused verbatim: MediaPipe wrapper, gesture engine, math utils, shader, pick/explode
logic, mouse/keyboard fallbacks, overlay drawing, UI language.
Replaced: the hand-coded `models/*` geometry (now compiled from CAD).
Added: the entire import/compile/labels/editing pipeline.

---

See [`CAD_IMPORT_BUILD_GUIDE.md`](./CAD_IMPORT_BUILD_GUIDE.md) for the line-by-line
implementation of every module referenced above.
