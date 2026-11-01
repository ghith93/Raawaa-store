import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const override = packageJson.overrides?.minimatch;
const entries = Object.entries(lock.packages ?? {}).filter(([path]) =>
  /(?:^|\/)node_modules\/minimatch$/.test(path)
);

function isPatched(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 11 || (major === 11 && (minor > 0 || (minor === 0 && patch >= 1)));
}

if (!/^(?:\^|>=)11\.0\.1$/.test(override ?? '')) {
  console.error(`Expected a minimatch override at ^11.0.1 or >=11.0.1; found ${JSON.stringify(override)}.`);
  process.exitCode = 1;
} else if (entries.length === 0) {
  console.error('No locked minimatch package was found.');
  process.exitCode = 1;
} else {
  const vulnerable = entries.filter(([, metadata]) => !isPatched(metadata.version));
  if (vulnerable.length) {
    console.error(`Vulnerable minimatch lock entries: ${vulnerable.map(([path, metadata]) => `${path}@${metadata.version}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`minimatch lock guard passed: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} at patched versions (${entries.map(([, metadata]) => metadata.version).join(', ')}).`);
  }
}
