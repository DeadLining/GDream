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
      <progress aria-label={label} aria-valuetext={`${ready} / ${total}`} value={ready} max={total || 1} />
    </div>
  );
}
