import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, LogOut, Mail, ShieldCheck } from 'lucide-react';
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

const IVORY = '#f3efe2';

const loginInput =
  'h-12 w-full rounded-xl border border-[#f3efe2]/[0.12] bg-[#f3efe2]/[0.04] pl-11 pr-4 text-sm text-[#f3efe2] transition-colors placeholder:text-[#f3efe2]/25 hover:border-[#f3efe2]/20 focus:border-gold-300/60 focus:bg-[#f3efe2]/[0.06] focus:outline-none focus:ring-4 focus:ring-gold-300/10 [&:-webkit-autofill]:[-webkit-text-fill-color:#f3efe2] [&:-webkit-autofill]:[transition:background-color_9999s]';

const FEATURES = [
  ['Daily sales', 'Per-product sheet with canteen shares and remittances'],
  ['Consignees', 'Products, prices and running totals in one place'],
  ['Official reports', 'DepEd letterhead, ready to print and sign'],
];

function Seal({ size }: { size: string }) {
  return (
    <span className="rounded-full bg-gradient-to-br from-gold-300 via-gold-500 to-gold-300 p-[2px] shadow-[0_0_40px_rgba(233,203,50,0.25)]">
      <img src="/logos/qnhs.png" alt="Quiot National High School logo" className={cn('rounded-full bg-white p-0.5', size)} />
    </span>
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
    <div className="relative min-h-screen overflow-hidden bg-[#04110a] selection:bg-gold-300/40" style={{ color: IVORY }}>
      {/* light */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-[640px] rounded-full bg-brand-500/25 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-48 right-[-120px] size-[560px] rounded-full bg-gold-400/10 blur-[150px]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(243,239,226,0.07) 1px, transparent 0)', backgroundSize: '28px 28px' }}
      />
      {/* certificate frame */}
      <div className="pointer-events-none absolute inset-3 rounded-[28px] border border-gold-300/15 sm:inset-5" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-14 px-6 py-14 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
        {/* Story */}
        <section className="hidden lg:block">
          <div className="flex items-center gap-4">
            <Seal size="size-14" />
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-gold-300/90">Quiot National High School</div>
              <div className="mt-1 text-xs text-[#f3efe2]/50">School ID 312515 · Schools Division of Cebu City</div>
            </div>
          </div>

          <h2 className="mt-14 font-display text-[56px] font-normal leading-[1.04] tracking-[-0.02em]">
            The canteen ledger,
            <br />
            <span className="italic text-gold-300">kept with care.</span>
          </h2>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[#f3efe2]/60">
            Every peso sold, shared and remitted, recorded once and reported exactly, from the daily sheet to the principal&apos;s signature.
          </p>

          <ol className="mt-12 max-w-md divide-y divide-[#f3efe2]/10 border-y border-[#f3efe2]/10">
            {FEATURES.map(([t, d], i) => (
              <li key={t} className="flex items-baseline gap-5 py-4">
                <span className="font-display text-sm italic text-gold-300/80">0{i + 1}</span>
                <span>
                  <span className="block text-sm font-medium">{t}</span>
                  <span className="mt-0.5 block text-[13px] text-[#f3efe2]/50">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Sign in */}
        <section className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <Seal size="size-16" />
            <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.32em] text-gold-300/90">Quiot National High School</div>
          </div>

          <div className="rounded-[26px] bg-gradient-to-b from-gold-300/30 via-[#f3efe2]/10 to-transparent p-px shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="rounded-[25px] bg-[#071a10]/90 px-7 py-9 backdrop-blur-xl sm:px-9">
              <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-[#f3efe2]/45">Canteen Management</div>
              <h1 className="mt-3 font-display text-[34px] font-normal leading-none tracking-[-0.01em]">Welcome back</h1>
              <p className="mt-3 text-[13px] text-[#f3efe2]/55">Sign in with the account issued by the school administrator.</p>

              <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
                {error && <Callout tone="danger">{error}</Callout>}
                <label className="block">
                  <span className="mb-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-[#f3efe2]/60">Email</span>
                  <span className="relative block">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#f3efe2]/40" />
                    <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@deped.gov.ph" className={loginInput} />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-[#f3efe2]/60">Password</span>
                  <span className="relative block">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#f3efe2]/40" />
                    <input
                      id="password"
                      type={show ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={cn(loginInput, 'pr-12')}
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#f3efe2]/45 transition-colors hover:bg-[#f3efe2]/10 hover:text-[#f3efe2]"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={busy || !email.trim() || !password}
                  className="group mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 text-sm font-semibold text-[#1c1806] shadow-[0_10px_30px_rgba(233,203,50,0.25),inset_0_1px_0_rgba(255,255,255,0.45)] transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    <>
                      Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-8 flex items-center gap-3 border-t border-[#f3efe2]/10 pt-6 text-xs text-[#f3efe2]/45">
                <ShieldCheck className="size-4 shrink-0 text-gold-300/70" />
                No public registration. Accounts are created by the administrator.
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#f3efe2]/35">
            <img src="/logos/deped.png" alt="DepEd seal" className="size-6 rounded-full bg-white/90 p-px opacity-80" />
            Department of Education
          </div>
        </section>
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
