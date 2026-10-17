import { buildJet } from './jet.js';
import { buildRadial } from './radial.js';
import { buildCar } from './car.js';
import { buildBrain } from './brain.js';

// Built-in demo designs. They are hardcoded so anyone can explore the
// experience straight away, before importing a CAD file of their own.
// view = starting rotation (radians). Parts are built lazily on first show.
export const MODELS = [
  {
    id: 'jet',
    name: 'Turbofan Jet Engine',
    category: 'Machines',
    subtitle: 'Fan, compressors, combustor, turbines, nozzle',
    view: { x: 0.28, y: -0.55, z: 0 },
    demo: true,
    build: buildJet,
  },
  {
    id: 'radial',
    name: 'Radial Aircraft Engine',
    category: 'Machines',
    subtitle: 'Nine cylinders around one crankshaft',
    view: { x: 0.35, y: 0.55, z: 0 },
    demo: true,
    build: buildRadial,
  },
  {
    id: 'car',
    name: 'Sports Car',
    category: 'Machines',
    subtitle: 'Body, chassis, drivetrain and interior',
    view: { x: 0.3, y: -0.7, z: 0 },
    demo: true,
    build: buildCar,
  },
  {
    id: 'brain',
    name: 'Human Brain',
    category: 'Biology',
    subtitle: 'Lobes, cerebellum and the structures inside',
    view: { x: 0.18, y: 0.7, z: 0 },
    demo: true,
    build: buildBrain,
  },
];

export const DEMO_MODELS = MODELS.filter((m) => m.demo);
