import { useMemo, useState } from 'react';
import type { Candle } from '../../core/types';
import { useElementSize } from './useElementSize';
import { formatRatio, formatTime } from '../../utils/format';

interface Hover {
  index: number;
  x: number;
  y: number;
}

/**
 * Candlestick + volume chart.
 *
 * Hand-drawn SVG rather than a charting dependency: it resizes with the module,
 * keeps the terminal's tokens, and stays cheap enough to run several per deck.
 */
export function CandleChart({
  candles,
  label,
  showVolume = true,
  style = 'candles',
}: {
  candles: Candle[];
  label?: string;
  showVolume?: boolean;
  style?: 'candles' | 'line';
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(1);

  const visible = useMemo(() => {
    if (!candles.length) return [];
    const count = Math.max(12, Math.floor(candles.length / zoom));
    return candles.slice(-count);
  }, [candles, zoom]);

  const width = Math.max(size.width, 1);
  const height = Math.max(size.height, 1);
  const volumeHeight = showVolume ? Math.min(48, height * 0.22) : 0;
  const priceHeight = Math.max(1, height - volumeHeight - 14);

  const geometry = useMemo(() => {
    if (!visible.length) return null;
    const highs = visible.map((c) => c.h);
    const lows = visible.map((c) => c.l);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const span = max - min || max || 1;
    const pad = span * 0.06;
    const top = max + pad;
    const bottom = Math.max(0, min - pad);
    const range = top - bottom || 1;
    const slot = width / visible.length;
    const bodyWidth = Math.max(1, Math.min(slot * 0.62, 12));
    const maxVolume = Math.max(...visible.map((c) => c.v), 1);
    const yFor = (price: number) => priceHeight - ((price - bottom) / range) * priceHeight;
    return { top, bottom, range, slot, bodyWidth, maxVolume, yFor, max, min };
  }, [visible, width, priceHeight]);

  if (!candles.length) {
    return (
      <div ref={ref} className="empty" style={{ height: '100%' }}>
        <h5>NO SERIES</h5>
        <p>Select a pair to initialise this chart.</p>
      </div>
    );
  }

  const last = visible[visible.length - 1];
  const first = visible[0];
  const changePct = first && last ? ((last.c - first.o) / first.o) * 100 : 0;
  const hovered = hover ? visible[hover.index] : null;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 90 }}>
      {geometry && width > 8 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label ?? 'price'} chart`}
          onWheel={(event) => {
            event.preventDefault();
            setZoom((prev) => Math.min(8, Math.max(1, prev * (event.deltaY > 0 ? 0.85 : 1.18))));
          }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const index = Math.min(visible.length - 1, Math.max(0, Math.floor(x / geometry.slot)));
            setHover({ index, x, y: event.clientY - rect.top });
          }}
        >
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={width}
              y1={priceHeight * fraction}
              y2={priceHeight * fraction}
              stroke="var(--border-faint)"
              strokeWidth={1}
            />
          ))}

          {style === 'line' ? (
            <polyline
              points={visible
                .map((candle, index) => `${index * geometry.slot + geometry.slot / 2},${geometry.yFor(candle.c)}`)
                .join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.3}
            />
          ) : (
            visible.map((candle, index) => {
              const x = index * geometry.slot + geometry.slot / 2;
              const rising = candle.c >= candle.o;
              const color = rising ? 'var(--up)' : 'var(--down)';
              const openY = geometry.yFor(candle.o);
              const closeY = geometry.yFor(candle.c);
              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1, Math.abs(closeY - openY));
              return (
                <g key={candle.t}>
                  <line
                    x1={x}
                    x2={x}
                    y1={geometry.yFor(candle.h)}
                    y2={geometry.yFor(candle.l)}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.75}
                  />
                  <rect
                    x={x - geometry.bodyWidth / 2}
                    y={bodyTop}
                    width={geometry.bodyWidth}
                    height={bodyHeight}
                    fill={rising ? 'transparent' : color}
                    stroke={color}
                    strokeWidth={1}
                  />
                </g>
              );
            })
          )}

          {showVolume
            ? visible.map((candle, index) => {
                const x = index * geometry.slot + geometry.slot / 2;
                const barHeight = (candle.v / geometry.maxVolume) * (volumeHeight - 4);
                return (
                  <rect
                    key={`v${candle.t}`}
                    x={x - geometry.bodyWidth / 2}
                    y={height - 14 - barHeight}
                    width={geometry.bodyWidth}
                    height={Math.max(0.5, barHeight)}
                    fill={candle.c >= candle.o ? 'var(--up)' : 'var(--down)'}
                    opacity={0.28}
                  />
                );
              })
            : null}

          {hover && hovered ? (
            <g>
              <line
                x1={hover.index * geometry.slot + geometry.slot / 2}
                x2={hover.index * geometry.slot + geometry.slot / 2}
                y1={0}
                y2={height - 14}
                stroke="var(--accent)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <line
                x1={0}
                x2={width}
                y1={geometry.yFor(hovered.c)}
                y2={geometry.yFor(hovered.c)}
                stroke="var(--accent)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.5}
              />
            </g>
          ) : null}
        </svg>
      ) : null}

      <div
        className="row"
        style={{
          position: 'absolute',
          top: 4,
          left: 6,
          right: 6,
          gap: 'var(--space-4)',
          pointerEvents: 'none',
          fontSize: 'var(--text-3xs)',
        }}
      >
        {label ? <span className="label">{label}</span> : null}
        <span className="mono-num">{formatRatio(hovered?.c ?? last?.c ?? 0)}</span>
        <span className={changePct >= 0 ? 'up' : 'down'}>
          {changePct >= 0 ? '+' : ''}
          {changePct.toFixed(2)}%
        </span>
        <span className="grow" />
        {geometry ? (
          <span className="faint">
            H {formatRatio(geometry.max)} · L {formatRatio(geometry.min)}
          </span>
        ) : null}
        {zoom > 1 ? <span className="chip">ZOOM {zoom.toFixed(1)}×</span> : null}
      </div>

      {hover && hovered ? (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(hover.x + 8, 4), Math.max(4, width - 150)),
            top: 20,
            pointerEvents: 'none',
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-strong)',
            padding: '2px 6px',
            fontSize: 'var(--text-3xs)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="faint">{formatTime(hovered.t)}</div>
          <div className="mono-num">
            O {formatRatio(hovered.o)} · H {formatRatio(hovered.h)}
          </div>
          <div className="mono-num">
            L {formatRatio(hovered.l)} · C {formatRatio(hovered.c)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
