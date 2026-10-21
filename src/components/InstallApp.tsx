import { useState } from 'react';
import { Download, MoreVertical, PlusSquare, Share } from 'lucide-react';
import { toast } from 'sonner';
import { useInstall } from '@/lib/install';
import { cn } from '@/lib/utils';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';

/**
 * "Get the app" button. Opens the browser's install prompt where there is
 * one; otherwise (iPhone, or a browser without a prompt) shows the steps.
 * Hidden once the app is installed and opened as an app.
 */
export function InstallAppButton({ variant = 'app', className }: { variant?: 'login' | 'app'; className?: string }) {
  const { installed, platform, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (installed) return null;

  const onClick = async () => {
    if (platform === 'prompt') {
      if (await install()) toast.success('QNHS Canteen is installed. Open it from your home screen or apps.');
    } else setHelp(true);
  };

  return (
    <>
      {variant === 'login' ? (
        <button
          type="button"
          onClick={() => void onClick()}
          className={cn(
            'group flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-gold-300/35 bg-gold-300/[0.06] text-sm font-medium text-gold-300 transition-colors hover:border-gold-300/60 hover:bg-gold-300/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-300/20',
            className,
          )}
        >
          <Download className="size-4" /> Get the app
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => void onClick()} className={className} title="Install QNHS Canteen on this device">
          <Download /> <span className="hidden md:inline">Get the app</span>
        </Button>
      )}

      <Dialog
        open={help}
        onOpenChange={setHelp}
        size="sm"
        title="Install QNHS Canteen"
        description="Add the app to your home screen to open it like any other app."
        footer={<Button onClick={() => setHelp(false)}>Got it</Button>}
      >
        {platform === 'ios' ? (
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <Step n={1} /> Tap <Share className="inline size-4 text-brand-600" /> <b>Share</b> at the bottom of Safari.
            </li>
            <li className="flex items-center gap-3">
              <Step n={2} /> Choose <PlusSquare className="inline size-4 text-brand-600" /> <b>Add to Home Screen</b>.
            </li>
            <li className="flex items-center gap-3">
              <Step n={3} /> Tap <b>Add</b>.
            </li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <Step n={1} /> Open the browser menu <MoreVertical className="inline size-4 text-brand-600" /> (Chrome or Edge works best).
            </li>
            <li className="flex items-center gap-3">
              <Step n={2} /> Choose <b>Install app</b> or <b>Add to Home screen</b>.
            </li>
            <li className="flex items-center gap-3">
              <Step n={3} /> Confirm with <b>Install</b>.
            </li>
          </ol>
        )}
      </Dialog>
    </>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{n}</span>;
}
