import AppIcon from "./AppIcon";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  maxWidth?: number;
  className?: string;
};

export default function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxWidth,
  className,
}: SearchFieldProps) {
  return (
    <div
      className={`search-field${className ? ` ${className}` : ""}`}
      style={maxWidth ? { maxWidth } : undefined}
    >
      <AppIcon name="search" size={18} />
      <input
        className="input"
        type="text"
        inputMode="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
