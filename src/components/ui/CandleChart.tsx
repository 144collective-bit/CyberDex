import { useMemo, useState } from 'react';
import type { Candle, Timeframe } from '../../core/types';
import { useElementSize } from './useElementSize';
import { formatRatio, formatTime } from '../../utils/format';
import {
  formatAxisPrice,
  formatAxisTime,
  movingAverage,
  niceTicks,
  priceExtent,
  tickIndices,
} from './chartScale';

interface Hover {
  index: number;
  x: number;
  y: number;
}

export interface MovingAverageSpec {
  period: number;
  color: string;
}

/** Room for the axis labels. The chart is drawn inside what is left. */
const PRICE_AXIS_WIDTH = 54;
const TIME_AXIS_HEIGHT = 16;

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
  timeframe = '1h',
  movingAverages = [],
}: {
  candles: Candle[];
  label?: string;
  showVolume?: boolean;
  style?: 'candles' | 'line';
  timeframe?: Timeframe;
  movingAverages?: MovingAverageSpec[];
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
  const plotWidth = Math.max(1, width - PRICE_AXIS_WIDTH);
  const volumeHeight = showVolume ? Math.min(48, height * 0.22) : 0;
  const priceHeight = Math.max(1, height - volumeHeight - TIME_AXIS_HEIGHT);

  const geometry = useMemo(() => {
    if (!visible.length) return null;
    const { top, bottom } = priceExtent(visible);
    const range = top - bottom || 1;
    const slot = plotWidth / visible.length;
    const bodyWidth = Math.max(1, Math.min(slot * 0.62, 12));
    const maxVolume = Math.max(...visible.map((c) => c.v), 1);
    const yFor = (price: number) => priceHeight - ((price - bottom) / range) * priceHeight;
    const priceFor = (y: number) => bottom + ((priceHeight - y) / priceHeight) * range;
    const xFor = (index: number) => index * slot + slot / 2;
    return { top, bottom, range, slot, bodyWidth, maxVolume, yFor, priceFor, xFor };
  }, [visible, plotWidth, priceHeight]);

  // Averages are computed over the visible window's closes, so the line means
  // the same thing as the candles beneath it.
  const averages = useMemo(() => {
    if (!movingAverages.length || !visible.length) return [];
    const closes = visible.map((candle) => candle.c);
    return movingAverages.map((spec) => ({
      ...spec,
      values: movingAverage(closes, spec.period),
    }));
  }, [movingAverages, visible]);

  const priceTicks = useMemo(
    () => (geometry ? niceTicks(geometry.bottom, geometry.top, Math.max(2, Math.floor(priceHeight / 34))) : []),
    [geometry, priceHeight],
  );
  const priceStep = priceTicks.length > 1 ? priceTicks[1]! - priceTicks[0]! : 0;

  const timeTicks = useMemo(
    () => (visible.length ? tickIndices(visible.length, Math.max(2, Math.floor(plotWidth / 90))) : []),
    [visible.length, plotWidth],
  );

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
  const lastRising = last ? last.c >= last.o : true;
  const crosshairY = hover ? Math.min(priceHeight, Math.max(0, hover.y)) : 0;

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
            if (x > plotWidth) {
              setHover(null);
              return;
            }
            const index = Math.min(visible.length - 1, Math.max(0, Math.floor(x / geometry.slot)));
            setHover({ index, x, y: event.clientY - rect.top });
          }}
        >
          {/* Gridlines sit on the labelled prices, so a line means a number. */}
          {priceTicks.map((price) => (
            <g key={`p${price}`}>
              <line
                x1={0}
                x2={plotWidth}
                y1={geometry.yFor(price)}
                y2={geometry.yFor(price)}
                stroke="var(--border-faint)"
                strokeWidth={1}
              />
              <text
                x={plotWidth + 4}
                y={geometry.yFor(price) + 3}
                fill="var(--text-muted)"
                fontSize={9}
                fontFamily="var(--font-mono)"
              >
                {formatAxisPrice(price, priceStep)}
              </text>
            </g>
          ))}

          {timeTicks.map((index) => {
            const candle = visible[index];
            if (!candle) return null;
            const x = geometry.xFor(index);
            // A label centred on the first or last candle hangs off the plot;
            // anchor it inward instead of letting the edge cut it in half.
            const anchor = x < 24 ? 'start' : x > plotWidth - 24 ? 'end' : 'middle';
            return (
              <g key={`t${candle.t}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={height - TIME_AXIS_HEIGHT}
                  stroke="var(--border-faint)"
                  strokeWidth={1}
                  opacity={0.5}
                />
                <text
                  x={x}
                  y={height - 4}
                  fill="var(--text-muted)"
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  textAnchor={anchor}
                >
                  {formatAxisTime(candle.t, timeframe)}
                </text>
              </g>
            );
          })}

          {style === 'line' ? (
            <polyline
              points={visible.map((candle, index) => `${geometry.xFor(index)},${geometry.yFor(candle.c)}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.3}
            />
          ) : (
            visible.map((candle, index) => {
              const x = geometry.xFor(index);
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

          {averages.map((average) => (
            <polyline
              key={average.period}
              points={average.values
                .map((value, index) => (value === null ? null : `${geometry.xFor(index)},${geometry.yFor(value)}`))
                .filter((point): point is string => point !== null)
                .join(' ')}
              fill="none"
              stroke={average.color}
              strokeWidth={1.1}
              opacity={0.9}
            />
          ))}

          {showVolume
            ? visible.map((candle, index) => {
                const x = geometry.xFor(index);
                const barHeight = (candle.v / geometry.maxVolume) * (volumeHeight - 4);
                return (
                  <rect
                    key={`v${candle.t}`}
                    x={x - geometry.bodyWidth / 2}
                    y={height - TIME_AXIS_HEIGHT - barHeight}
                    width={geometry.bodyWidth}
                    height={Math.max(0.5, barHeight)}
                    fill={candle.c >= candle.o ? 'var(--up)' : 'var(--down)'}
                    opacity={0.28}
                  />
                );
              })
            : null}

          {/* The last close, tagged on the axis — the number you look for first. */}
          {last ? (
            <g>
              <line
                x1={0}
                x2={plotWidth}
                y1={geometry.yFor(last.c)}
                y2={geometry.yFor(last.c)}
                stroke={lastRising ? 'var(--up)' : 'var(--down)'}
                strokeWidth={0.8}
                strokeDasharray="2 3"
                opacity={0.6}
              />
              <rect
                x={plotWidth}
                y={geometry.yFor(last.c) - 7}
                width={PRICE_AXIS_WIDTH}
                height={14}
                fill={lastRising ? 'var(--up)' : 'var(--down)'}
                opacity={0.9}
              />
              <text
                x={plotWidth + 4}
                y={geometry.yFor(last.c) + 3}
                fill="var(--bg-deep)"
                fontSize={9}
                fontFamily="var(--font-mono)"
              >
                {formatRatio(last.c)}
              </text>
            </g>
          ) : null}

          {hover && hovered ? (
            <g>
              <line
                x1={geometry.xFor(hover.index)}
                x2={geometry.xFor(hover.index)}
                y1={0}
                y2={height - TIME_AXIS_HEIGHT}
                stroke="var(--accent)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <line
                x1={0}
                x2={plotWidth}
                y1={crosshairY}
                y2={crosshairY}
                stroke="var(--accent)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.5}
              />
              {/* The crosshair's own price and time, read off the axes — the
                  difference between a chart you look at and one you measure. */}
              <rect x={plotWidth} y={crosshairY - 7} width={PRICE_AXIS_WIDTH} height={14} fill="var(--accent)" />
              <text
                x={plotWidth + 4}
                y={crosshairY + 3}
                fill="var(--bg-deep)"
                fontSize={9}
                fontFamily="var(--font-mono)"
              >
                {formatRatio(geometry.priceFor(crosshairY))}
              </text>
              <rect
                x={Math.max(0, Math.min(plotWidth - 52, geometry.xFor(hover.index) - 26))}
                y={height - TIME_AXIS_HEIGHT}
                width={52}
                height={TIME_AXIS_HEIGHT}
                fill="var(--accent)"
              />
              <text
                x={Math.max(26, Math.min(plotWidth - 26, geometry.xFor(hover.index)))}
                y={height - 4}
                fill="var(--bg-deep)"
                fontSize={9}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                {formatAxisTime(hovered.t, timeframe)}
              </text>
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
          right: PRICE_AXIS_WIDTH + 6,
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
        {averages.map((average) => (
          <span key={average.period} className="mono-num" style={{ color: average.color }}>
            MA{average.period}
          </span>
        ))}
        <span className="grow" />
        {zoom > 1 ? <span className="chip">ZOOM {zoom.toFixed(1)}×</span> : null}
      </div>

      {hover && hovered ? (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(hover.x + 8, 4), Math.max(4, plotWidth - 150)),
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
