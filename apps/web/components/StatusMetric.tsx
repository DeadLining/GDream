export function StatusMetric({
  label,
  ready,
  total,
}: {
  label: string;
  ready: number;
  total: number;
}) {
  return (
    <div className="status-metric">
      <div className="status-metric-summary">
        <span>{label}</span>
        <strong>{ready} / {total}</strong>
      </div>
      {total === 0 ? (
        <span className="status-metric-empty" aria-label={`${label}：无项目`}>暂无项目</span>
      ) : (
        <progress aria-label={label} aria-valuetext={`${ready} / ${total}`} value={ready} max={total} />
      )}
    </div>
  );
}
