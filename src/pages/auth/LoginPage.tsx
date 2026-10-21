import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogIn, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth';
import { Button } from '@/components/ui/button';
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
    <div
      className="relative min-h-screen bg-[#f4f7f2]"
      style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 31px, rgba(8,122,53,0.06) 31px 32px)' }}
    >
      {/* Official band */}
      <div className="absolute inset-x-0 top-0 h-[300px] bg-brand-700">
        <div className="absolute inset-x-0 bottom-0 h-1 bg-gold-400" />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 pt-6 text-white">
          <div className="flex items-center gap-3">
            <img src="/logos/deped.png" alt="DepEd seal" className="size-10 rounded-full bg-white p-0.5" />
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">Department of Education</div>
              <div className="text-[11px] text-white/70">Schools Division of Cebu City · Region VII</div>
            </div>
          </div>
          <img src="/logos/bagong-pilipinas.jpg" alt="Bagong Pilipinas" className="hidden size-10 rounded-full bg-white object-contain p-0.5 sm:block" />
        </div>
      </div>

      <main className="relative flex min-h-screen flex-col items-center px-5 pb-10 pt-28">
        <div className="w-full max-w-[420px] rounded-2xl border border-surface-border bg-white px-7 pb-8 shadow-overlay sm:px-9">
          <img src="/logos/qnhs.png" alt="Quiot National High School logo" className="mx-auto -mt-11 size-[88px] rounded-full bg-white p-1 shadow-md ring-4 ring-white" />
          <div className="mt-4 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">Quiot National High School</div>
            <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight text-ink">Canteen Management System</h1>
            <p className="mt-1 text-[13px] text-ink-muted">Sign in with the account issued by the school administrator.</p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error && <Callout tone="danger">{error}</Callout>}
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Email address</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@deped.gov.ph" className={loginInput} />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Password</span>
              <span className="relative block">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={cn(loginInput, 'pr-11')} />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted hover:bg-surface-page hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <Button type="submit" size="lg" className="mt-2 w-full" loading={busy} disabled={!email.trim() || !password}>
              <LogIn /> Sign in
            </Button>
          </form>

          <div className="mt-7 flex items-start gap-2.5 rounded-xl bg-surface-page px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
            <ShieldCheck className="mt-px size-4 shrink-0 text-brand-600" />
            There is no public registration. Accounts are created by the administrator.
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-4 opacity-80">
            <img src="/logos/deped-wordmark.webp" alt="DepEd" className="h-7 object-contain" />
            <img src="/logos/matatag.png" alt="MATATAG" className="h-7 object-contain" />
          </div>
          <div className="text-xs text-ink-muted">School ID 312515 · Sitio Bogo, Quiot, Cebu City</div>
        </div>
      </main>
    </div>
  );
}

const loginInput =
  'h-11 w-full rounded-xl border border-surface-border bg-white pl-10 pr-3 text-sm text-ink transition-colors placeholder:text-ink-soft hover:border-[#cfd9d2] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15';

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
