function withoutYamlComment(line) {
  let quote = '';
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }

    if (character === '"' || character === "'") quote = character;
    else if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }

  return line;
}

/**
 * Find a GitHub Actions `runs-on` target that could route a job away from the
 * repository's approved GitHub-hosted runner policy. Runner groups, self-hosted
 * labels, and expressions are rejected; only the approved `ubuntu-24.04` scalar is allowed.
 */
export function findUnsafeRunnerTarget(workflowText) {
  if (typeof workflowText !== 'string') throw new TypeError('workflowText must be a string');

  const lines = workflowText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = withoutYamlComment(lines[index]);
    const match = sourceLine.match(/^([ \t]*)runs-on[ \t]*:[ \t]*(.*)$/i);
    if (!match) continue;

    const indentation = match[1].length;
    const runnerSpec = [match[2].trim()];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = withoutYamlComment(lines[next]);
      if (!line.trim()) continue;
      const nextIndentation = line.match(/^[ \t]*/)[0].length;
      if (nextIndentation <= indentation) break;
      runnerSpec.push(line.trim());
    }

    const value = runnerSpec.join('\n');
    if (/\bself-hosted\b/i.test(value)) return { line: index + 1, reason: 'self-hosted label' };
    if (/\bgroup\s*:/i.test(value)) return { line: index + 1, reason: 'runner group' };
    if (/\$\{\{/i.test(value)) return { line: index + 1, reason: 'dynamic runner expression' };
    if (value !== 'ubuntu-24.04' && value !== '"ubuntu-24.04"' && value !== "'ubuntu-24.04'") {
      return { line: index + 1, reason: 'unapproved runner target' };
    }
  }

  return null;
}
