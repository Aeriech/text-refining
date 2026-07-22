"use client";

interface ToneSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  lowLabel: string;
  midLabel: string;
  highLabel: string;
}

export default function ToneSlider({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
  disabled = false,
  lowLabel,
  midLabel,
  highLabel,
}: ToneSliderProps) {
  const description =
    value <= 3 ? lowLabel : value <= 7 ? midLabel : highLabel;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">{label}</span>
        <span className="rounded-md border border-border bg-panel-2 px-2 py-0.5 text-xs font-mono text-text tabular-nums min-w-[34px] text-center">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent cursor-pointer disabled:cursor-not-allowed"
        aria-label={`${label}: ${description}`}
      />
      <div className="flex justify-between text-[11px] text-muted">
        <span>{lowLabel}</span>
        <span className="text-accent font-medium">{description}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
