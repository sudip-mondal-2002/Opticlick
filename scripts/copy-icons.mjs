import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const icons = [
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'icon.svg'
];

const srcDir = path.join(rootDir, 'src', 'assets');
const targets = [
  path.join(rootDir, 'public'),
  path.join(rootDir, 'docs'),
  path.join(rootDir, 'sandbox', 'public')
];

// Ensure srcDir exists
if (!fs.existsSync(srcDir)) {
  console.error(`Source directory ${srcDir} does not exist!`);
  process.exit(1);
}

console.log('Copying icons...');
let copiedCount = 0;

for (const target of targets) {
  // Ensure target folder exists
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    console.log(`Created target directory: ${path.relative(rootDir, target)}`);
  }
  for (const icon of icons) {
    const srcFile = path.join(srcDir, icon);
    const destFile = path.join(target, icon);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      copiedCount++;
    } else {
      console.warn(`Warning: Source icon ${path.relative(rootDir, srcFile)} not found!`);
    }
  }
}

console.log(`Successfully copied ${copiedCount} icons across destinations.`);
