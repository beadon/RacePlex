/**
 * Segmented single/halves/quarters (or any string-set) toggle, shared by the
 * setup editor and the post-session panel so the "pick a granularity" control
 * looks and behaves identically everywhere it's used.
 */
export function ModeToggle<T extends string>({
  options, labels, value, onChange,
}: {
  options: readonly T[];
  labels: string[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 bg-muted/50 rounded-md p-0.5">
      {options.map((opt, i) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            value === opt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}
