interface MeterProps {
  label: string;
  /** 0–100 */
  percent: number;
  text: string;
  className?: string;
}

export function Meter({ label, percent, text, className = "" }: MeterProps) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  return (
    <div className={`meter ${className}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-text">{text}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="meter-track"
      >
        <span className="meter-fill" style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}
