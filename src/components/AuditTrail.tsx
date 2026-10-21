import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';
import { formatDateTime, titleCase } from '@/lib/utils';
import type { AuditLog } from '@/lib/types';

const HIDDEN = new Set(['id', 'updated_at', 'created_at', 'version', 'updated_by', 'created_by', 'school_year_id', 'idempotency_key', 'import_fingerprint']);

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function ChangeList({ oldV, newV }: { oldV: Record<string, unknown> | null; newV: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})])].filter((k) => !HIDDEN.has(k));
  if (keys.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-xs">
      {keys.slice(0, 14).map((k) => (
        <div key={k} className="flex flex-wrap gap-x-2">
          <span className="text-ink-muted">{titleCase(k)}:</span>
          {oldV && k in oldV && <span className="text-danger-600 line-through decoration-danger-500/40">{fmt(oldV[k])}</span>}
          {newV && k in newV && <span className="text-brand-700">{fmt(newV[k])}</span>}
        </div>
      ))}
    </div>
  );
}

/** Audit history of one record (requires audit.view; RLS enforces it). */
export function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { can } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ['audit', entityType, entityId],
    enabled: can('audit.view'),
    queryFn: async () =>
      unwrap(
        await supabase.from('audit_logs').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false }).limit(50),
      ) as AuditLog[],
  });
  if (!can('audit.view')) return <p className="text-xs text-ink-muted">Audit history is visible to users with audit access.</p>;
  if (isLoading) return <p className="text-xs text-ink-muted">Loading history…</p>;
  if (data.length === 0) return <p className="text-xs text-ink-muted">No history recorded.</p>;
  return (
    <ol className="relative space-y-4 border-l border-surface-border pl-5">
      {data.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1 flex size-3 items-center justify-center rounded-full bg-surface ring-2 ring-brand-500" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{titleCase(a.action)}</span>
            <span className="text-xs text-ink-muted">
              by {a.user_name ?? 'system'} · {formatDateTime(a.created_at)}
            </span>
          </div>
          {a.context && <div className="mt-0.5 text-xs italic text-ink-muted">“{a.context}”</div>}
          {a.action === 'update' && <ChangeList oldV={a.old_values} newV={a.new_values} />}
        </li>
      ))}
    </ol>
  );
}

export function AuditIcon() {
  return <History />;
}
