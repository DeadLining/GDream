// M1.2: post-render review badge.
// Fetches the latest render review for an episode and surfaces a compact
// pass/fail/warning badge so operators know whether the render is clean
// before publishing.

'use client';

import {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, Loader2, XCircle} from 'lucide-react';

export type SlideshowRisk = {
  score: number;
  level: 'ok' | 'warning' | 'critical';
  dimensions: Record<string, number>;
  triggered: string[];
};

export type RenderReview = {
  id: string;
  episode_id: string;
  job_id: string | null;
  render_path: string;
  overall_pass: boolean;
  subtitle_present: boolean;
  black_frame_positions: number[];
  silence_ranges: Array<{start: number; end: number}>;
  findings: Array<{code: string; severity: string; positions?: number[]; ratio?: number}>;
  slideshow_risk: SlideshowRisk | null;
  created_at: string | null;
};

type Props = {
  episodeId: string;
  /** When true, render nothing while loading (badge appears once ready). */
  silent?: boolean;
};

export function RenderReviewBadge({episodeId, silent = true}: Props) {
  const [review, setReview] = useState<RenderReview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    fetch(`/api/episodes/${episodeId}/render-review`)
      .then(response => {
        if (response.status === 404) {
          if (active) setStatus('none');
          return null;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: RenderReview | null) => {
        if (!active) return;
        if (data) {
          setReview(data);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [episodeId]);

  if (status === 'loading') {
    return silent ? null : (
      <span className="render-review-badge render-review-loading">
        <Loader2 size={12} className="spin" /> 检查中…
      </span>
    );
  }
  if (status === 'none' || status === 'error') {
    return null; // No render yet or fetch failed — hide the badge.
  }
  if (!review) return null;

  const critical = review.findings.filter(f => f.severity === 'critical');
  const isPass = review.overall_pass && critical.length === 0;

  const risk = review.slideshow_risk;
  const riskLabel = risk
    ? risk.level === 'critical'
      ? 'PPT 风险高'
      : risk.level === 'warning'
      ? 'PPT 风险中'
      : '动态良好'
    : null;
  const riskClass = risk
    ? risk.level === 'critical'
      ? 'render-review-risk-critical'
      : risk.level === 'warning'
      ? 'render-review-risk-warning'
      : 'render-review-risk-ok'
    : '';
  const riskTitle = risk
    ? `Slideshow Risk ${risk.score.toFixed(2)}（${risk.level}）${
        risk.triggered.length > 0 ? `；触发：${risk.triggered.join('、')}` : ''
      }`
    : '';

  const mainBadge = isPass ? (
    <span className="render-review-badge render-review-pass" title="渲染产物通过质量自检">
      <CheckCircle2 size={12} /> 自检通过
    </span>
  ) : (
    <span
      className="render-review-badge render-review-fail"
      title={`渲染自检未通过：${critical.map(f => f.code).join('、')}`}
    >
      <XCircle size={12} /> 自检未通过
      <AlertTriangle size={11} className="render-review-warning-icon" />
    </span>
  );

  return (
    <span className="render-review-badge-group">
      {mainBadge}
      {riskLabel && (
        <span
          className={`render-review-badge render-review-risk ${riskClass}`}
          title={riskTitle}
          aria-label={`Slideshow risk ${risk?.level}`}
        >
          <AlertTriangle size={11} /> {riskLabel}
        </span>
      )}
    </span>
  );
}
