import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePortfolioHealth } from './portfolioAudit.ts';

test('summarizes blocked, warning, audited, and unavailable projects', () => {
  assert.deepEqual(summarizePortfolioHealth([
    { projectId: 'p1', status: 'blocked', blockedCount: 2, warningCount: 0 },
    { projectId: 'p2', status: 'warn', blockedCount: 0, warningCount: 1 },
    { projectId: 'p3', status: 'pass', blockedCount: 0, warningCount: 0 },
    { projectId: 'p4', status: 'unavailable', blockedCount: 0, warningCount: 0 },
  ]), {
    auditedProjectCount: 3,
    unavailableProjectCount: 1,
    blockedProjectCount: 1,
    warningProjectCount: 1,
  });
});

test('portfolio health ignores optional per-project issue details', () => {
  assert.deepEqual(summarizePortfolioHealth([
    { projectId: 'p1', status: 'blocked', blockedCount: 1, warningCount: 0, topIssue: '缺少当前剧本 Draft Review' },
  ]), {
    auditedProjectCount: 1,
    unavailableProjectCount: 0,
    blockedProjectCount: 1,
    warningProjectCount: 0,
  });
});
