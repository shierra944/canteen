import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Callout } from '@/components/ui/feedback';

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img src="/logos/qnhs.png" alt="Quiot National High School logo" className="size-14 rounded-full bg-white p-0.5 shadow-sm" />
      <div>
        <div className="text-lg font-bold tracking-wide text-ink">QNHS CANTEEN</div>
        <div className="text-xs text-ink-muted">Inventory &amp; Financial Management</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-700 lg:block">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <div className="absolute -right-24 -top-24 size-[420px] rounded-full bg-brand-600/60" />
        <div className="absolute -bottom-32 -left-20 size-[360px] rounded-full bg-brand-800/70" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/logos/qnhs.png" alt="" className="size-12 rounded-full bg-white p-0.5" />
            <div className="text-sm font-semibold tracking-wide text-white/90">Quiot National High School</div>
          </div>
          <div className="max-w-md">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-gold-300 ring-1 ring-inset ring-white/15">
              <ShieldCheck className="size-3.5" /> Schools Division of Cebu City
            </div>
            <h2 className="text-[34px] font-semibold leading-tight tracking-tight">
              Accurate canteen records,
              <br />
              <span className="text-gold-300">every school day.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/70">
              Daily sales, inventory, expenses and fund allocation in one place, with official reports ready for the principal's signature.
            </p>
          </div>
          <div className="text-xs text-white/45">School ID 312515 · Sitio Bogo, Quiot, Cebu City</div>
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center bg-surface-page px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-muted">Use the account issued to you by the school administrator.</p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {error && <Callout tone="danger">{error}</Callout>}
            <Field label="Email address" htmlFor="email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="name@deped.gov.ph" />
              </div>
            </Field>
            <Field label="Password" htmlFor="password">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="px-9" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>
          <p className="mt-8 text-center text-xs text-ink-muted">
            No account? Accounts are created by the administrator — there is no public registration.
          </p>
        </div>
      </div>
    </div>
  );
}

export function InactiveAccount() {
  const { signOut, profile } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-5">
      <div className="card w-full max-w-md p-8 text-center">
        <img src="/logos/qnhs.png" alt="" className="mx-auto size-14 rounded-full" />
        <h1 className="mt-5 text-lg font-semibold">Account awaiting activation</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {profile?.email} is signed in, but the account is not active. Ask the school administrator to activate it and assign a role.
        </p>
        <Button variant="secondary" className="mt-6" onClick={() => void signOut()}>
          <LogOut /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-5">
      <div className="card w-full max-w-lg p-8">
        <Brand />
        <h1 className="mt-6 text-lg font-semibold">Connect to Supabase</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Create a <code className="rounded bg-surface-sunken px-1">.env.local</code> file (see <code className="rounded bg-surface-sunken px-1">.env.example</code>) with
          <code className="mx-1 rounded bg-surface-sunken px-1">VITE_SUPABASE_URL</code> and
          <code className="mx-1 rounded bg-surface-sunken px-1">VITE_SUPABASE_ANON_KEY</code>, then restart the app. Setup steps are in README.md.
        </p>
      </div>
    </div>
  );
}
