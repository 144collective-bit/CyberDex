export function Sparkline({
  values,
  width = 120,
  height = 28,
  tone,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'up' | 'down' | 'flat';
}) {
  if (values.length < 2) {
    return <div className="skeleton" style={{ width, height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((value, index) => `${(index * step).toFixed(2)},${(height - ((value - min) / span) * height).toFixed(2)}`)
    .join(' ');
  const color =
    tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--accent)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="price sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
