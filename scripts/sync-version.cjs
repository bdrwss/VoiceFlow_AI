const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const tauriConfPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(__dirname, '..', 'src-tauri', 'Cargo.toml');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
console.log(`Syncing version ${version} to Tauri and Cargo...`);

// Update tauri.conf.json
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log('Updated tauri.conf.json');
} else {
  console.warn('tauri.conf.json not found!');
}

// Update Cargo.toml
if (fs.existsSync(cargoTomlPath)) {
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  // replace version in [package] section
  cargoToml = cargoToml.replace(/(\[package\][\s\S]*?version\s*=\s*")[^"]+(")/, `$1${version}$2`);
  fs.writeFileSync(cargoTomlPath, cargoToml);
  console.log('Updated Cargo.toml');
} else {
  console.warn('Cargo.toml not found!');
}

console.log('Version sync complete.');
