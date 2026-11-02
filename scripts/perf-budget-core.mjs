/** Pure Lighthouse budget evaluation helpers; no browser, network, or package dependencies. */

export const BUDGETS = Object.freeze({
  'first-contentful-paint': 1800,
  'largest-contentful-paint': 2500,
  'total-blocking-time': 200,
  'cumulative-layout-shift': 0.1,
  'speed-index': 3400
});

export const MIN_CATEGORY = Object.freeze({
  performance: 90,
  accessibility: 95,
  'best-practices': 95,
  seo: 95
});

export const MAX_CONFIRMATION_RUNS = 5;

export function median(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every(Number.isFinite)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function checkMedian(reports, { id, label, selector, limit, direction, scale = 1, unit = '' }) {
  const readings = reports.map(selector);
  const complete = readings.every(value => typeof value === 'number' && Number.isFinite(value));
  const value = complete ? median(readings) * scale : null;
  const passes = complete && (direction === 'min' ? value >= limit : value <= limit);
  return {
    id,
    label,
    value,
    limit,
    direction,
    unit,
    readings: readings.map(reading => typeof reading === 'number' && Number.isFinite(reading) ? reading * scale : null),
    pass: passes
  };
}

/**
 * Evaluate configured budgets using the median, preserving fail-closed handling
 * for absent/non-finite scores and audits. Values and thresholds are unchanged.
 */
export function evaluateReports(reports) {
  const safeReports = Array.isArray(reports) ? reports : [];
  const checks = [
    ...Object.entries(MIN_CATEGORY).map(([id, limit]) => checkMedian(safeReports, {
      id: `category:${id}`,
      label: `score ${id}`,
      selector: report => report?.categories?.[id]?.score,
      limit,
      direction: 'min',
      scale: 100,
      unit: '%'
    })),
    ...Object.entries(BUDGETS).map(([id, limit]) => checkMedian(safeReports, {
      id: `audit:${id}`,
      label: safeReports.find(report => typeof report?.audits?.[id]?.title === 'string')?.audits[id].title || id,
      selector: report => report?.audits?.[id]?.numericValue,
      limit,
      direction: 'max',
      unit: id === 'cumulative-layout-shift' ? '' : 'ms'
    })),
    checkMedian(safeReports, {
      id: 'audit:total-byte-weight',
      label: 'total page weight',
      selector: report => report?.audits?.['total-byte-weight']?.numericValue,
      limit: 900 * 1024,
      direction: 'max',
      unit: 'bytes'
    })
  ];
  const failures = checks.filter(check => !check.pass);
  return { pass: failures.length === 0, checks, failures };
}

/** Add confirmation readings only when the initial aggregate fails. */
export function needsConfirmation(evaluation, reportCount, maxRuns = MAX_CONFIRMATION_RUNS) {
  return Boolean(evaluation && !evaluation.pass && reportCount < maxRuns);
}

export function formatCheckValue(check, value = check.value) {
  if (!Number.isFinite(value)) return 'missing';
  if (check.id === 'audit:cumulative-layout-shift') return value.toFixed(3);
  if (check.id.startsWith('category:')) return `${value.toFixed(1)}%`;
  if (check.id === 'audit:total-byte-weight') return `${(value / 1048576).toFixed(2)} MB`;
  return `${Math.round(value)}ms`;
}
