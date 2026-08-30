import { ChevronDown } from 'lucide-react';
import { storedSignatures } from './signatures';

export function SignaturePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (signatureId: string) => void;
}) {
  const signatures = storedSignatures();

  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">Signature</span>
      <span className="relative min-w-0 max-w-56 flex-1">
        <select
          className="field h-8 appearance-none py-1 pl-2 pr-7 text-xs"
          value={value}
          disabled={disabled}
          aria-label="Signature"
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">No signature</option>
          {signatures.map((signature) => (
            <option key={signature.id} value={signature.id}>
              {signature.name || 'Untitled signature'}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-2 size-3.5" />
      </span>
      <span className="hidden sm:inline">Editable in the message</span>
    </label>
  );
}
