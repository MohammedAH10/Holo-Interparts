#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node scripts/compile.mjs <design.json>');
    return;
  }
  const designPath = args[0];
  const design = JSON.parse(await fs.readFile(designPath, 'utf8'));
  console.log('Compiling:', design.name || 'model');
  console.log('Output will be written to public/models/');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
