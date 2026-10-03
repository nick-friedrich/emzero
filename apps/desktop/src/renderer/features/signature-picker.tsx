import { useSyncExternalStore } from 'react';
import { ChevronDown, Signature } from 'lucide-react';
import { storedSignatures, subscribeSignatures } from './signatures';

export function SignaturePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (signatureId: string) => void;
}) {
  const signatures = useSyncExternalStore(subscribeSignatures, storedSignatures);
  if (signatures.length === 0 && !value) return null;

  return (
    <label
      className="relative flex h-8 min-w-0 max-w-44 items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      title="Signature — editable in the message"
    >
      <Signature className="pointer-events-none absolute left-2 size-4" />
      <select
        className="h-8 min-w-0 cursor-pointer appearance-none truncate bg-transparent pl-8 pr-6 text-xs outline-none disabled:cursor-default disabled:opacity-50"
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
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5" />
    </label>
  );
}
