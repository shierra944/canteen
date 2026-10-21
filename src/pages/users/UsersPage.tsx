import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { friendlyError, rpc, supabase, unwrap } from '@/lib/supabase';
import { keys, useAction, usePermissionsCatalog } from '@/lib/queries';
import { PERMISSION_GROUPS, ROLE_DEFAULTS, ROLE_LABEL } from '@/lib/labels';
import { cn, formatDate, initials } from '@/lib/utils';
import type { AppRole, Profile } from '@/lib/types';
import { PageHeader } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Callout, EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { toast } from 'sonner';

type UserRow = Profile & { user_permissions: { permission: string }[] };

function useUsersFull() {
  return useQuery({
    queryKey: [...keys.users, 'full'],
    queryFn: async () => unwrap(await supabase.from('profiles').select('*, user_permissions!user_permissions_user_id_fkey(permission)').order('full_name')) as UserRow[],
  });
}

async function callAdminFn(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = (await ctx.json()).error ?? msg;
    } catch {
      /* keep message */
    }
    throw new Error(/Failed to send|not found/i.test(msg) ? 'The admin-users function is not deployed. See README → Deploy the Edge Function.' : friendlyError({ message: msg }));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function UsersPage() {
  const { profile, isAdmin } = useAuth();
  const { data: users = [], isLoading } = useUsersFull();
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('');
  const shown = roleFilter ? users.filter((u) => u.role === roleFilter) : users;
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [reset, setReset] = useState<UserRow | null>(null);

  return (
    <>
      <PageHeader
        title="User Management"
        description="Accounts, roles and permissions. There is no public sign-up — every account is created here."
        actions={
          <Button onClick={() => setEdit('new')}>
            <UserPlus /> Add user
          </Button>
        }
      />
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        {(['admin', 'staff', 'viewer'] as AppRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter((f) => (f === r ? '' : r))}
            aria-pressed={roleFilter === r}
            className={cn('card group p-4 text-left transition-[box-shadow,border-color] hover:shadow-raised', roleFilter === r ? 'border-brand-500 ring-2 ring-brand-500/20' : 'hover:border-brand-200')}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-brand-600" /> {ROLE_LABEL[r]}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {r === 'admin'
                ? 'Full access to every module, settings, users and the audit log.'
                : r === 'staff'
                  ? 'Records daily sales, expenses and other sales. Extra powers (inventory, corrections, settings) only when granted.'
                  : 'Views permitted dashboards and reports. Can never add or change records.'}
            </p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-ink-muted">{users.filter((u) => u.role === r).length} users</span>
              <span className="font-medium text-brand-600">{roleFilter === r ? 'Showing only these — click to show all' : 'View users →'}</span>
            </div>
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users />} title="No users" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Extra permissions</TH>
                <TH>Status</TH>
                <TH>Created</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {shown.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{initials(u.full_name)}</span>
                      <div>
                        <div className="font-medium">
                          {u.full_name} {u.id === profile?.id && <span className="text-xs text-ink-muted">(you)</span>}
                        </div>
                        <div className="text-xs text-ink-muted">{u.email}{u.position ? ` · ${u.position}` : ''}</div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={u.role === 'admin' ? 'gold' : u.role === 'staff' ? 'green' : 'gray'}>{ROLE_LABEL[u.role]}</Badge>
                  </TD>
                  <TD className="max-w-[320px]">
                    <div className="flex flex-wrap gap-1">
                      {u.role === 'admin' ? (
                        <span className="text-xs text-ink-muted">All permissions</span>
                      ) : u.user_permissions.length === 0 ? (
                        <span className="text-xs text-ink-muted">Role defaults only</span>
                      ) : (
                        u.user_permissions.map((p) => (
                          <Badge key={p.permission} tone="blue">{p.permission}</Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD>{u.is_active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="red" dot>Inactive</Badge>}</TD>
                  <TD className="text-ink-muted">{formatDate(u.created_at)}</TD>
                  <TD align="right">
                    {(isAdmin || u.role !== 'admin') && (
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem icon={<Pencil />} onSelect={() => setEdit(u)}>Edit role & permissions</MenuItem>
                          <MenuItem icon={<KeyRound />} onSelect={() => setReset(u)}>Reset password</MenuItem>
                        </MenuContent>
                      </Menu>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserDialog user={edit} onClose={() => setEdit(null)} />
      <ResetDialog user={reset} onClose={() => setReset(null)} />
    </>
  );
}

function UserDialog({ user, onClose }: { user: UserRow | 'new' | null; onClose: () => void }) {
  const { profile, isAdmin } = useAuth();
  const { data: catalog = [] } = usePermissionsCatalog();
  const isNew = user === 'new';
  const [f, setF] = useState({ full_name: '', email: '', position: '', password: '', role: 'staff' as AppRole, is_active: true });
  const [perms, setPerms] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    if (user === 'new') {
      setF({ full_name: '', email: '', position: '', password: '', role: 'staff', is_active: true });
      setPerms([]);
    } else {
      setF({ full_name: user.full_name, email: user.email ?? '', position: user.position ?? '', password: '', role: user.role, is_active: user.is_active });
      setPerms(user.user_permissions.map((p) => p.permission));
    }
  }, [user]);
  const self = !isNew && user && user.id === profile?.id;
  const save = useAction(
    async () => {
      if (isNew) {
        return callAdminFn({ action: 'create', email: f.email, password: f.password, full_name: f.full_name, position: f.position, role: f.role, permissions: perms });
      }
      return rpc('admin_update_user', { p_user_id: (user as UserRow).id, p_full_name: f.full_name, p_position: f.position, p_role: f.role, p_is_active: f.is_active, p_permissions: perms });
    },
    { success: isNew ? 'User created. Share the temporary password securely.' : 'User updated.', invalidate: [keys.users, keys.audit], onSuccess: onClose },
  );
  const defaults = ROLE_DEFAULTS[f.role] ?? [];
  const isWrite = (code: string) => catalog.find((c) => c.code === code)?.is_write ?? true;

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={isNew ? 'Add user' : `Edit ${(user as UserRow | null)?.full_name ?? ''}`}
      description="Permissions are enforced by the database on every action."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={save.isPending}
            disabled={!f.full_name.trim() || (isNew && (!f.email.trim() || f.password.length < 10))}
            onClick={() => save.mutate(undefined)}
          >
            {isNew ? <><Plus /> Create user</> : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required>
          <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label="Position / designation">
          <Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="e.g. Canteen Manager" />
        </Field>
        <Field label="Email" required={isNew}>
          <Input type="email" value={f.email} disabled={!isNew} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        {isNew ? (
          <Field label="Temporary password" required hint="At least 10 characters. Ask the user to change it after first sign-in.">
            <Input type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        ) : (
          <Field label="Account status">
            <Select value={f.is_active ? '1' : '0'} disabled={Boolean(self)} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}>
              <option value="1">Active</option>
              <option value="0">Deactivated (cannot sign in to data)</option>
            </Select>
          </Field>
        )}
        <Field label="Role" required className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['admin', 'staff', 'viewer'] as AppRole[]).map((r) => (
              <button
                key={r}
                type="button"
                disabled={Boolean(self) || (r === 'admin' && !isAdmin)}
                onClick={() => setF({ ...f, role: r })}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50',
                  f.role === r ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-border hover:bg-surface-page',
                )}
              >
                <div className="font-medium">{ROLE_LABEL[r]}</div>
              </button>
            ))}
          </div>
          {self && <p className="mt-1 text-xs text-ink-muted">You cannot change your own role or deactivate yourself.</p>}
        </Field>
        {f.role !== 'admin' && (
          <div className="sm:col-span-2 space-y-4">
            <div className="text-[13px] font-medium">Permissions</div>
            {f.role === 'viewer' && <Callout tone="info">Viewers can only receive read permissions. Write permissions are refused by the database.</Callout>}
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="label-caps mb-2">{g.title}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.codes.map((code) => {
                    const info = catalog.find((c) => c.code === code);
                    const isDefault = defaults.includes(code);
                    const blocked = f.role === 'viewer' && isWrite(code);
                    return (
                      <Checkbox
                        key={code}
                        checked={isDefault || perms.includes(code)}
                        disabled={isDefault || blocked}
                        onChange={(v) => setPerms((p) => (v ? [...p, code] : p.filter((x) => x !== code)))}
                        label={<span className="font-mono text-xs">{code}</span>}
                        description={`${info?.description ?? ''}${isDefault ? ' (role default)' : ''}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPw(''), [user]);
  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={`Reset password — ${user?.full_name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            disabled={pw.length < 10}
            onClick={async () => {
              setBusy(true);
              try {
                await callAdminFn({ action: 'reset_password', user_id: user!.id, password: pw });
                toast.success('Password reset. Share it securely with the user.');
                onClose();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset password
          </Button>
        </>
      }
    >
      <Field label="New temporary password" hint="At least 10 characters.">
        <Input value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
      </Field>
    </Dialog>
  );
}
