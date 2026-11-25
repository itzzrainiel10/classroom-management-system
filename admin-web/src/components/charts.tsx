import { useState } from 'react';

/**
 * Single-series column chart (one hue, no legend — the card title names the series).
 * Columns ≤ 24px with a 4px rounded top, hairline grid, hover tooltip, and a screen-reader table.
 */
export function ColumnChart({ data, unit, height = 200 }: { data: { label: string; value: number; detail?: string }[]; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const padL = 34;
  const padB = 26;
  const plotH = height - padB - 8;
  const max = Math.max(4, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = (W - padL) / data.length;
  const barW = Math.min(24, band * 0.5);
  const y = (v: number) => 8 + plotH - (v / top) * plotH;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${unit} per day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, h);
          const x = cx - barW / 2;
          const yTop = y(d.value);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target larger than the mark */}
              <rect x={padL + band * i} y={8} width={band} height={plotH} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${y(0)} Z`}
                  fill="var(--chart)"
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              ) : null}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize={11.5} fill={hover === i ? 'var(--text)' : 'var(--text-soft)'} fontWeight={hover === i ? 700 : 500}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null ? (
        <div className="tip" style={{ left: `${((padL + (W - padL) / data.length * (hover + 0.5)) / W) * 100}%`, top: `${(y(data[hover].value) / height) * 100 - 2}%` }}>
          <b>{data[hover].value}</b> {unit} · {data[hover].detail ?? data[hover].label}
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{unit} per day</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.detail ?? d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Labeled horizontal bars on a 0–100% scale; the value is printed at the bar end so color is never the only cue. */
export function PercentBars({ rows }: { rows: { label: string; value: number | null; title?: string }[] }) {
  return (
    <div style={{ padding: '10px 20px 14px' }}>
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={r.title}>
          <div className="name">{r.label}</div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.max(0, Math.min(100, r.value ?? 0))}%` }} />
          </div>
          <div className="val">{r.value == null ? '—' : `${Math.round(r.value)}%`}</div>
        </div>
      ))}
    </div>
  );
}
