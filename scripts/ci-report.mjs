import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- pinpoint-ci-report -->';
export const WARN_THRESHOLD = 80;
const METRICS = ['statements', 'branches', 'functions', 'lines'];
const MAX_FAILURES = 10;
const MAX_ERROR_LENGTH = 160;
const SKIPPED_STATUSES = new Set(['pending', 'skipped', 'todo']);

const escapeCell = (text) => String(text).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const formatDuration = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const formatPct = (pct) => (typeof pct === 'number' ? `${Number(pct.toFixed(2))}%` : 'n/a');

const formatDelta = (current, base) => {
  if (typeof current !== 'number' || typeof base !== 'number') return '–';
  const diff = Math.round((current - base) * 100) / 100;
  if (diff === 0) return '±0';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`;
};

const warn = (pct) => (typeof pct === 'number' && pct < WARN_THRESHOLD ? ' ⚠️' : '');

export function relativePath(file, root) {
  const normalized = file.replaceAll('\\', '/');
  if (!isAbsolute(file)) return normalized.replace(/^\.\//, '');
  return relative(root, file).replaceAll('\\', '/');
}

export function summarizeResults(json) {
  const files = json.testResults ?? [];
  const failures = [];
  let skipped = 0;
  let endTime = json.startTime ?? 0;

  for (const file of files) {
    endTime = Math.max(endTime, file.endTime ?? 0);
    const tests = file.assertionResults ?? [];
    for (const test of tests) {
      if (test.status === 'failed') {
        const firstLine = (test.failureMessages?.[0] ?? '').split('\n').find((line) => line.trim());
        failures.push({
          name: test.fullName || test.title,
          file: file.name,
          error: firstLine?.trim() ?? '',
        });
      } else if (SKIPPED_STATUSES.has(test.status)) {
        skipped += 1;
      }
    }
    if (file.status === 'failed' && !tests.some((test) => test.status === 'failed')) {
      const firstLine = (file.message ?? '').split('\n').find((line) => line.trim());
      failures.push({
        name: '(suite failed to run)',
        file: file.name,
        error: firstLine?.trim() ?? '',
      });
    }
  }

  const failedFiles = files.filter((file) => file.status === 'failed').length;
  return {
    totalTests: json.numTotalTests ?? 0,
    passedTests: json.numPassedTests ?? 0,
    failedTests: json.numFailedTests ?? 0,
    skippedTests: skipped,
    totalFiles: files.length,
    failedFiles,
    duration: json.startTime ? endTime - json.startTime : 0,
    failures,
  };
}

function testsSection(results, root) {
  if (!results) return ['### Tests', '', '_No test results found._'];
  const s = summarizeResults(results);
  const status = s.failedTests > 0 || s.failedFiles > 0 ? '❌' : '✅';
  const lines = [
    '### Tests',
    '',
    '| | Total | Passed | Failed | Skipped |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| ${status} Tests | ${s.totalTests} | ${s.passedTests} | ${s.failedTests} | ${s.skippedTests} |`,
    `| Files | ${s.totalFiles} | ${s.totalFiles - s.failedFiles} | ${s.failedFiles} | – |`,
    '',
    `Duration: ${formatDuration(s.duration)}`,
  ];
  return [...lines, ...failureList(s.failures, 'Failing tests', root)];
}

function failureList(failures, title, root) {
  if (failures.length === 0) return [];
  const lines = ['', `**${title}**`, ''];
  for (const failure of failures.slice(0, MAX_FAILURES)) {
    const message = truncate(failure.error, MAX_ERROR_LENGTH).replaceAll('`', "'");
    const error = message ? ` — \`${message}\`` : '';
    lines.push(`- ${escapeCell(failure.name)} (${relativePath(failure.file, root)})${error}`);
  }
  if (failures.length > MAX_FAILURES) {
    lines.push(`- … and ${failures.length - MAX_FAILURES} more`);
  }
  return lines;
}

/** Summarises Playwright's JSON reporter output (`--reporter=json`). */
export function summarizePlaywright(json) {
  const stats = json.stats ?? {};
  const failures = [];
  const visit = (suite, titles) => {
    const path = suite.title && !suite.title.endsWith('.ts') ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== 'unexpected') continue;
        const last = test.results?.[test.results.length - 1];
        const firstLine = (last?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((line) => line.trim());
        failures.push({ name: [...path, spec.title].join(' › '), file: spec.file ?? suite.file ?? '', error: firstLine?.trim() ?? '' });
      }
    }
    for (const child of suite.suites ?? []) visit(child, path);
  };
  for (const suite of json.suites ?? []) visit(suite, []);
  for (const error of json.errors ?? []) {
    failures.push({ name: '(run error)', file: '', error: (error.message ?? '').split('\n')[0] });
  }
  return {
    passedTests: (stats.expected ?? 0) + (stats.flaky ?? 0),
    failedTests: stats.unexpected ?? 0,
    flakyTests: stats.flaky ?? 0,
    skippedTests: stats.skipped ?? 0,
    duration: stats.duration ?? 0,
    failures,
    hasErrors: (json.errors ?? []).length > 0,
  };
}

/** One line for the Playwright e2e suite; `null` means it was expected but left no results. */
function browserSection(results, root) {
  if (results === undefined) return [];
  if (!results) return ['', '❌ E2E tests (Playwright, Chromium): _no results found._'];
  const s = summarizePlaywright(results);
  const failed = s.failedTests > 0 || s.hasErrors;
  const extra = [s.flakyTests > 0 ? `${s.flakyTests} flaky` : '', s.skippedTests > 0 ? `${s.skippedTests} skipped` : '']
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join('');
  return [
    '',
    `${failed ? '❌' : '✅'} E2E tests (Playwright, Chromium): ${s.passedTests} passed, ${s.failedTests} failed${extra} in ${formatDuration(s.duration)}`,
    ...failureList(s.failures, 'Failing e2e tests', root),
  ];
}

function coverageSection(coverage, baseline, changedFiles, root) {
  if (!coverage?.total) return ['### Coverage', '', '_No coverage data found._'];
  const hasBase = Boolean(baseline?.total);
  const lines = [
    '### Coverage',
    '',
    hasBase ? '| Metric | Coverage | Base | Δ |' : '| Metric | Coverage | Covered |',
    hasBase ? '| --- | ---: | ---: | ---: |' : '| --- | ---: | ---: |',
  ];
  for (const key of METRICS) {
    const now = coverage.total[key];
    if (hasBase) {
      const base = baseline.total[key]?.pct;
      lines.push(
        `| ${key} | ${formatPct(now.pct)}${warn(now.pct)} | ${formatPct(base)} | ${formatDelta(now.pct, base)} |`,
      );
    } else {
      lines.push(
        `| ${key} | ${formatPct(now.pct)}${warn(now.pct)} | ${now.covered}/${now.total} |`,
      );
    }
  }
  if (!hasBase) lines.push('', '_No baseline available from main._');

  const byPath = new Map();
  for (const [file, data] of Object.entries(coverage)) {
    if (file !== 'total') byPath.set(relativePath(file, root), data);
  }
  const rows = changedFiles
    .filter((file) => byPath.has(file))
    .sort()
    .map((file) => {
      const data = byPath.get(file);
      const low = data.lines.pct < WARN_THRESHOLD || data.branches.pct < WARN_THRESHOLD;
      return `| ${low ? '⚠️ ' : ''}\`${file}\` | ${formatPct(data.lines.pct)} | ${formatPct(data.branches.pct)} |`;
    });
  lines.push('', '**Changed files**', '');
  if (rows.length === 0) {
    lines.push('_No covered source files changed._');
  } else {
    lines.push('| File | Lines | Branches |', '| --- | ---: | ---: |', ...rows);
    lines.push('', `⚠️ marks coverage below ${WARN_THRESHOLD}%.`);
  }
  return lines;
}

export function buildReport({
  results,
  browserResults,
  coverage,
  baseline,
  changedFiles = [],
  root = process.cwd(),
}) {
  return [
    MARKER,
    '## CI report',
    '',
    ...testsSection(results, root),
    ...browserSection(browserResults, root),
    '',
    ...coverageSection(coverage, baseline, changedFiles, root),
    '',
  ].join('\n');
}

function readJson(path) {
  if (!path || !existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function readLines(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function main(argv) {
  const args = Object.fromEntries(
    argv.flatMap((arg) => {
      const match = /^--([^=]+)=(.*)$/.exec(arg);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  const report = buildReport({
    results: readJson(args.results),
    browserResults: args.browser ? (readJson(args.browser) ?? null) : undefined,
    coverage: readJson(args.coverage),
    baseline: readJson(args.baseline),
    changedFiles: readLines(args.changed),
  });
  if (args.out) writeFileSync(args.out, report);
  else process.stdout.write(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
