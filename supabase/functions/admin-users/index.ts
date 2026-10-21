// Supabase Edge Function: create user accounts / reset passwords.
// The service-role key lives ONLY here (server side). The caller must be a
// signed-in user holding the users.manage permission, checked in the
// database with the caller's own JWT.
//
// Deploy:  supabase functions deploy admin-users
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['admin', 'staff', 'viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // 1) Verify the caller with THEIR token (RLS + has_permission apply).
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in.' }, 401);
  const { data: allowed } = await caller.rpc('has_permission', { p_permission: 'users.manage' });
  if (!allowed) return json({ error: 'You do not have permission to manage users.' }, 403);
  const { data: isAdmin } = await caller.rpc('is_admin');

  const admin = createClient(url, service, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'staff');
    const position = body.position ? String(body.position) : null;
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (password.length < 10) return json({ error: 'Temporary password must be at least 10 characters.' }, 400);
    if (!fullName) return json({ error: 'Full name is required.' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400);
    if (role === 'admin' && !isAdmin) return json({ error: 'Only administrators can create administrator accounts.' }, 403);

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) return json({ error: /already/i.test(error.message) ? 'A user with this email already exists.' : error.message }, 400);

    // Role, activation and permissions are applied through the audited RPC,
    // executed with the caller's token so the audit log names the admin.
    const { error: rpcError } = await caller.rpc('admin_update_user', {
      p_user_id: created.user.id,
      p_full_name: fullName,
      p_position: position,
      p_role: role,
      p_is_active: true,
      p_permissions: permissions,
    });
    if (rpcError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: rpcError.message }, 400);
    }
    return json({ id: created.user.id });
  }

  if (body.action === 'reset_password') {
    const userId = String(body.user_id ?? '');
    const password = String(body.password ?? '');
    if (password.length < 10) return json({ error: 'Password must be at least 10 characters.' }, 400);
    const { data: target } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (!target) return json({ error: 'User not found.' }, 404);
    if (target.role === 'admin' && !isAdmin) return json({ error: 'Only administrators can reset an administrator password.' }, 403);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    await caller.rpc('log_password_reset', { p_user_id: userId });
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
