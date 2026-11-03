import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const APPROVED_RUNNER = 'ubuntu-24.04';

function sourceLine(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function pairFor(map, key) {
  if (!isMap(map)) return undefined;
  return map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);
}

function unsafe(line, reason) {
  return { line, reason };
}

/**
 * Fail closed unless every executable job declares the one approved GitHub-hosted
 * runner. Parsing YAML structurally covers block and flow mappings, quoted keys,
 * aliases, runner groups, arrays, and expressions without relying on line patterns.
 */
export function findUnsafeRunnerTarget(workflowText) {
  if (typeof workflowText !== 'string') throw new TypeError('workflowText must be a string');

  const document = parseDocument(workflowText, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length > 0) {
    const error = document.errors[0];
    const offset = error.pos?.[0] ?? 0;
    return unsafe(sourceLine(workflowText, offset), 'invalid YAML');
  }

  const jobsPair = pairFor(document.contents, 'jobs');
  if (!jobsPair || !isMap(jobsPair.value) || jobsPair.value.items.length === 0) {
    const offset = jobsPair?.key?.range?.[0] ?? 0;
    return unsafe(sourceLine(workflowText, offset), 'missing or invalid jobs mapping');
  }

  for (const jobPair of jobsPair.value.items) {
    const jobName = isScalar(jobPair.key) ? String(jobPair.key.value) : '<unknown>';
    if (!isMap(jobPair.value)) {
      const offset = jobPair.value?.range?.[0] ?? jobPair.key?.range?.[0] ?? 0;
      return unsafe(sourceLine(workflowText, offset), `job ${jobName} is not a mapping`);
    }

    const runnerPair = pairFor(jobPair.value, 'runs-on');
    if (!runnerPair) {
      const offset = jobPair.value.range?.[0] ?? jobPair.key?.range?.[0] ?? 0;
      const hasReusableWorkflow = Boolean(pairFor(jobPair.value, 'uses'));
      const reason = hasReusableWorkflow
        ? `job ${jobName} delegates to an unaudited reusable workflow`
        : `job ${jobName} has no explicit runner target`;
      return unsafe(sourceLine(workflowText, offset), reason);
    }

    const line = sourceLine(workflowText, runnerPair.key.range?.[0] ?? 0);
    const target = runnerPair.value;
    if (!isScalar(target) || typeof target.value !== 'string') {
      const hasSelfHostedLabel = isSeq(target) && target.items.some(
        (item) => isScalar(item) && typeof item.value === 'string' && /\bself-hosted\b/iu.test(item.value)
      );
      const reason = isMap(target) && pairFor(target, 'group')
        ? 'runner group'
        : hasSelfHostedLabel
          ? 'self-hosted label'
          : 'runner target is not a fixed scalar';
      return unsafe(line, reason);
    }

    if (/\$\{\{/u.test(target.value)) return unsafe(line, 'dynamic runner expression');
    if (/\bself-hosted\b/iu.test(target.value)) return unsafe(line, 'self-hosted label');
    if (target.value !== APPROVED_RUNNER) return unsafe(line, 'unapproved runner target');
  }

  return null;
}
