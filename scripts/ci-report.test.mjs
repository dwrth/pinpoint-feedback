import { describe, expect, it } from 'vitest';
import { MARKER, buildReport, relativePath, summarizePlaywright, summarizeResults } from './ci-report.mjs';

const vitestJson = {
  numTotalTests: 3,
  numPassedTests: 2,
  numFailedTests: 1,
  startTime: 1000,
  testResults: [
    {
      name: '/repo/packages/core/test/a.test.ts',
      status: 'failed',
      endTime: 2500,
      assertionResults: [
        { status: 'passed', fullName: 'a works', title: 'works' },
        { status: 'failed', fullName: 'a | breaks', title: 'breaks', failureMessages: ['\nExpected 1 to be 2\n  at x'] },
        { status: 'skipped', fullName: 'a skips', title: 'skips' },
      ],
    },
  ],
};

const playwrightJson = {
  stats: { expected: 4, unexpected: 1, flaky: 1, skipped: 0, duration: 23_500 },
  suites: [
    {
      title: 'feedback.spec.ts',
      file: 'feedback.spec.ts',
      specs: [
        { title: 'files feedback', file: 'feedback.spec.ts', tests: [{ status: 'expected', results: [] }] },
        {
          title: 'retries',
          file: 'feedback.spec.ts',
          tests: [{ status: 'unexpected', results: [{ error: { message: '\u001b[31mError: timed out\u001b[39m\nstack' } }] }],
        },
      ],
      suites: [],
    },
  ],
  errors: [],
};

const coverage = {
  total: {
    statements: { pct: 85, covered: 85, total: 100 },
    branches: { pct: 75, covered: 75, total: 100 },
    functions: { pct: 90, covered: 9, total: 10 },
    lines: { pct: 88, covered: 88, total: 100 },
  },
  '/repo/packages/core/src/a.ts': { lines: { pct: 95 }, branches: { pct: 60 } },
};

describe('ci-report', () => {
  it('summarises vitest results', () => {
    const s = summarizeResults(vitestJson);
    expect(s).toMatchObject({ totalTests: 3, failedTests: 1, skippedTests: 1, duration: 1500, failedFiles: 1 });
    expect(s.failures[0]).toMatchObject({ name: 'a | breaks', error: 'Expected 1 to be 2' });
  });

  it('summarises playwright results and strips ANSI codes', () => {
    const s = summarizePlaywright(playwrightJson);
    expect(s).toMatchObject({ passedTests: 5, failedTests: 1, flakyTests: 1, duration: 23_500 });
    expect(s.failures).toEqual([{ name: 'retries', file: 'feedback.spec.ts', error: 'Error: timed out' }]);
  });

  it('builds a report with coverage deltas and changed files', () => {
    const baseline = { total: { ...coverage.total, branches: { pct: 76.5 } } };
    const report = buildReport({
      results: vitestJson,
      browserResults: playwrightJson,
      coverage,
      baseline,
      changedFiles: ['packages/core/src/a.ts', 'README.md'],
      root: '/repo',
    });
    expect(report.startsWith(MARKER)).toBe(true);
    expect(report).toContain('| ❌ Tests | 3 | 2 | 1 | 1 |');
    expect(report).toContain('a \\| breaks');
    expect(report).toContain('❌ E2E tests (Playwright, Chromium): 5 passed, 1 failed, 1 flaky in 23.5 s');
    expect(report).toContain('| branches | 75%⚠️ | 76.5% | −1.5 |'.replace('⚠️', ' ⚠️'));
    expect(report).toContain('| ⚠️ `packages/core/src/a.ts` | 95% | 60% |');
    expect(report).not.toContain('README.md');
  });

  it('handles missing inputs', () => {
    const report = buildReport({ browserResults: null });
    expect(report).toContain('_No test results found._');
    expect(report).toContain('_no results found._');
    expect(report).toContain('_No coverage data found._');
  });

  it('relativises paths', () => {
    expect(relativePath('/repo/a/b.ts', '/repo')).toBe('a/b.ts');
    expect(relativePath('./a/b.ts', '/repo')).toBe('a/b.ts');
  });
});
