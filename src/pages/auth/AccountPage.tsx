import { useState, type FormEvent } from 'react';
import { KeyRound, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/providers/auth';
import { rpc, supabase, friendlyError } from '@/lib/supabase';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABEL } from '@/lib/labels';
import { titleCase } from '@/lib/utils';

export default function AccountPage() {
  const { profile, permissions, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [position, setPosition] = useState(profile?.position ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState<'profile' | 'pw' | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy('profile');
    try {
      await rpc('update_my_profile', { p_full_name: name, p_position: position });
      await refreshProfile();
      toast.success('Profile updated.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return toast.error('Use at least 10 characters.');
    if (pw !== pw2) return toast.error('Passwords do not match.');
    setBusy('pw');
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    setPw('');
    setPw2('');
    toast.success('Password changed.');
  }

  return (
    <>
      <PageHeader title="My account" description="Your profile, password and the permissions assigned by the administrator." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" icon={<UserRound />} />
          <CardBody>
            <form onSubmit={saveProfile} className="space-y-4">
              <Field label="Full name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Position / designation" hint="Shown on printed reports where you are a signatory.">
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Canteen Manager" />
              </Field>
              <Field label="Email">
                <Input value={profile?.email ?? ''} disabled />
              </Field>
              <div className="flex items-center justify-between">
                <Badge tone="green">{profile ? ROLE_LABEL[profile.role] : ''}</Badge>
                <Button type="submit" loading={busy === 'profile'}>
                  Save profile
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" icon={<KeyRound />} />
          <CardBody>
            <form onSubmit={changePassword} className="space-y-4">
              <Field label="New password" hint="At least 10 characters.">
                <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" loading={busy === 'pw'}>
                  Change password
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="My permissions" description="Granted by your role and by the administrator. The database enforces these on every action." />
          <CardBody className="flex flex-wrap gap-2">
            {permissions.map((p) => (
              <Badge key={p} tone="green">
                {titleCase(p)}
              </Badge>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
