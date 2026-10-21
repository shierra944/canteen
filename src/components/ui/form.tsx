import { createContext, forwardRef, useContext, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fixCompletedWords, fixSpelling } from '@/lib/spelling';

const fieldBase =
  'w-full rounded-xl border border-surface-border bg-surface px-3 text-sm text-ink shadow-[inset_0_1px_1px_rgba(16,40,24,0.03)] transition-colors placeholder:text-ink-soft hover:border-surface-strong focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus:ring-danger-500/20';

/** Set by <Field required>; inputs inside it highlight themselves while empty. */
const FieldContext = createContext<{ required?: boolean }>({});

/** Amber "needs input" treatment for a required control that is still empty. */
export const needsInputClass =
  'border-gold-500 bg-gold-50 hover:border-gold-500 focus:bg-surface placeholder:text-gold-600/70';

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

/** Highlight state for a control: required (from props or Field) and empty, not disabled. */
function useNeedsInput(props: { required?: boolean; value?: unknown; disabled?: boolean; 'aria-invalid'?: unknown }) {
  const ctx = useContext(FieldContext);
  const required = props.required ?? ctx.required ?? false;
  const empty = 'value' in props && isBlank(props.value);
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return { required, needs: required && empty && !props.disabled && !invalid };
}

// types whose text is never English words
const NO_SPELL_FIX = new Set(['email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'url', 'tel', 'color', 'file', 'hidden', 'range', 'checkbox', 'radio']);

/**
 * Automatic spelling correction for typed text: a known misspelled English
 * word is corrected as soon as it is finished (space or punctuation), and the
 * whole text again when the field loses focus. Words not on the list
 * (names, Filipino words) are never touched.
 */
function useSpellFix<T extends HTMLInputElement | HTMLTextAreaElement>(
  enabled: boolean,
  onChange?: (e: ChangeEvent<T>) => void,
  onBlur?: (e: FocusEvent<T>) => void,
) {
  if (!enabled) return { onChange, onBlur };
  return {
    onChange: (e: ChangeEvent<T>) => {
      const el = e.target;
      const caret = el.selectionStart ?? el.value.length;
      // only words before the caret, so the caret can be put back exactly
      const before = fixCompletedWords(el.value.slice(0, caret));
      if (before !== el.value.slice(0, caret)) {
        el.value = before + el.value.slice(caret);
        try {
          el.setSelectionRange(before.length, before.length);
        } catch {
          /* not supported for this input */
        }
      }
      onChange?.(e);
    },
    onBlur: (e: FocusEvent<T>) => {
      const fixed = fixSpelling(e.target.value);
      if (fixed !== e.target.value) {
        e.target.value = fixed;
        onChange?.(e as unknown as ChangeEvent<T>);
      }
      onBlur?.(e);
    },
  };
}

type SpellFixProp = { /** automatic spelling correction (default on for text) */ spellFix?: boolean };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: string } & SpellFixProp>(
  ({ className, prefix, required, spellFix = true, ...props }, ref) => {
    const { required: req, needs } = useNeedsInput({ required, ...props });
    const fix = useSpellFix<HTMLInputElement>(spellFix && !NO_SPELL_FIX.has(props.type ?? 'text') && !props.readOnly, props.onChange, props.onBlur);
    const shared = {
      ref,
      required,
      'aria-required': req || undefined,
      'data-needs-input': needs || undefined,
      title: needs ? 'Required — please fill in' : props.title,
      ...props,
      ...fix,
    };
    return prefix ? (
      <div className="relative">
        <span className={cn('pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm', needs ? 'text-gold-600' : 'text-ink-muted')}>{prefix}</span>
        <input {...shared} className={cn(fieldBase, 'h-10 pl-7', needs && needsInputClass, className)} />
      </div>
    ) : (
      <input {...shared} className={cn(fieldBase, 'h-10', needs && needsInputClass, className)} />
    );
  },
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & SpellFixProp>(({ className, required, spellFix = true, ...props }, ref) => {
  const { required: req, needs } = useNeedsInput({ required, ...props });
  const fix = useSpellFix<HTMLTextAreaElement>(spellFix && !props.readOnly, props.onChange, props.onBlur);
  return (
    <textarea
      ref={ref}
      required={required}
      aria-required={req || undefined}
      data-needs-input={needs || undefined}
      className={cn(fieldBase, 'min-h-[80px] py-2', needs && needsInputClass, className)}
      {...props}
      {...fix}
    />
  );
});
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, required, ...props }, ref) => {
    const { required: req, needs } = useNeedsInput({ required, ...props });
    return (
      <div className="relative">
        <select
          ref={ref}
          required={required}
          aria-required={req || undefined}
          data-needs-input={needs || undefined}
          className={cn(fieldBase, 'h-10 appearance-none pr-9', needs && needsInputClass, className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2', needs ? 'text-gold-600' : 'text-ink-muted')} />
      </div>
    );
  },
);
Select.displayName = 'Select';

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('group/field space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <span>
          {label}
          {required && <span className="ml-0.5 text-danger-500" aria-hidden>*</span>}
        </span>
        {required && (
          <span className="hidden rounded-full bg-gold-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-gold-600 group-has-[[data-needs-input]]/field:inline-flex">
            Required
          </span>
        )}
      </label>
      <FieldContext.Provider value={{ required }}>{children}</FieldContext.Provider>
      {error ? (
        <p className="text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-surface-border text-brand-600 accent-brand-600 focus:ring-brand-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-surface-strong',
      )}
    >
      <span className={cn('inline-block size-5 rounded-full bg-surface shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}
