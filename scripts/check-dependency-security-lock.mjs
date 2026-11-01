import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const policies = [
  { name: 'minimatch', floor: '11.0.1' },
  { name: 'glob', floor: '14.0.3' },
];

function atLeast(version, floor) {
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  const floorParts = floor.split('.').map(Number);
  if (!versionMatch) return false;
  const versionParts = versionMatch.slice(1).map(Number);
  for (let index = 0; index < floorParts.length; index += 1) {
    if (versionParts[index] !== floorParts[index]) return versionParts[index] > floorParts[index];
  }
  return true;
}

let failed = false;
for (const { name, floor } of policies) {
  const override = packageJson.overrides?.[name];
  if (override !== `^${floor}` && override !== `>=${floor}`) {
    console.error(`Expected ${name} override at ^${floor} or >=${floor}; found ${JSON.stringify(override)}.`);
    failed = true;
  }

  const suffix = `/node_modules/${name}`;
  const entries = Object.entries(lock.packages ?? {}).filter(([path]) =>
    path === `node_modules/${name}` || path.endsWith(suffix)
  );
  if (entries.length === 0) {
    console.error(`No locked ${name} package was found.`);
    failed = true;
    continue;
  }

  const vulnerable = entries.filter(([, metadata]) => !atLeast(metadata.version, floor));
  if (vulnerable.length) {
    console.error(`Unpatched ${name} lock entries: ${vulnerable.map(([path, metadata]) => `${path}@${metadata.version}`).join(', ')}`);
    failed = true;
  } else {
    console.log(`${name} lock guard passed: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} at patched version(s) ${entries.map(([, metadata]) => metadata.version).join(', ')}.`);
  }
}

if (failed) process.exitCode = 1;
