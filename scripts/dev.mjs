#!/usr/bin/env node
import { spawn } from 'node:child_process';

const children = new Set();
let shuttingDown = false;

function run(label, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.log(`[dev] ${label} stopped (${signal || code})`);
      shutdown(code || 0);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const timer = setTimeout(() => process.exit(code), 1200);
  timer.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .then(() => process.exit(code));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting Node backend and Vite…');
run('backend', process.execPath, ['server/index.mjs']);
run('vite', process.execPath, ['node_modules/vite/bin/vite.js', '--open']);
