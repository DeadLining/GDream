export type PortfolioAuditStatus = 'pass' | 'warn' | 'blocked' | 'unavailable';

export interface PortfolioAuditSummary {
  projectId: string;
  status: PortfolioAuditStatus;
  blockedCount: number;
  warningCount: number;
  topIssue?: string;
}

export interface PortfolioHealthSummary {
  auditedProjectCount: number;
  unavailableProjectCount: number;
  blockedProjectCount: number;
  warningProjectCount: number;
}

export function summarizePortfolioHealth(items: PortfolioAuditSummary[]): PortfolioHealthSummary {
  return {
    auditedProjectCount: items.filter((item) => item.status !== 'unavailable').length,
    unavailableProjectCount: items.filter((item) => item.status === 'unavailable').length,
    blockedProjectCount: items.filter((item) => item.status === 'blocked').length,
    warningProjectCount: items.filter((item) => item.status === 'warn').length,
  };
}
