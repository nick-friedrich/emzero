import {
  useState,
} from 'react';
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  cn,
} from '@/lib/utils';
import {
  type AccountSummary,
} from '../../shared/accounts';
import type { Status } from './app-shared';

export function AccountSettingsDialog({
  open,
  accounts,
  onOpenChange,
  onUpdated,
  onRemoved,
}: {
  open: boolean;
  accounts: AccountSummary[];
  onOpenChange: (open: boolean) => void;
  onUpdated: (account: AccountSummary) => void;
  onRemoved: (accountId: string) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const rename = async (account: AccountSummary) => {
    const name = names[account.id]?.trim() ?? '';
    if (!name) {
      setStatus({ kind: 'error', message: 'Enter a name for this account.' });
      return;
    }
    setBusyAccount(account.id);
    setStatus(null);
    try {
      const result = await window.emzero.accounts.update(account.id, { name });
      if (result.ok && result.account) {
        onUpdated(result.account);
        setStatus({ kind: 'success', message: result.message });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The account could not be updated.' });
    } finally {
      setBusyAccount(null);
    }
  };

  const remove = async (account: AccountSummary) => {
    setBusyAccount(account.id);
    setStatus(null);
    try {
      const result = await window.emzero.accounts.remove(account.id);
      if (result.ok) {
        onRemoved(account.id);
        setStatus({ kind: 'success', message: `${account.email} was deleted.` });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The account could not be deleted.' });
    } finally {
      setBusyAccount(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setNames({});
          setStatus(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>
            Rename connected accounts or remove them from Emzero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-account text-sm font-semibold text-primary">
                  {account.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                </div>
              </div>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename(account);
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Name for {account.email}</span>
                  <input
                    className="field"
                    value={names[account.id] ?? account.name}
                    disabled={busyAccount === account.id}
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [account.id]: event.target.value }))
                    }
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    busyAccount === account.id ||
                    !names[account.id]?.trim() ||
                    names[account.id]?.trim() === account.name
                  }
                >
                  {busyAccount === account.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  Save name
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 text-danger hover:text-danger"
                      aria-label={`Delete ${account.email}`}
                      title="Delete account"
                      disabled={busyAccount === account.id}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes {account.email} and its locally cached mail from Emzero. It
                        does not delete anything from your mail provider.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void remove(account)}>
                        Delete account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </form>
            </div>
          ))}
        </div>

        {status && (
          <p
            className={cn(
              'flex items-center gap-2 text-sm',
              status.kind === 'success' ? 'text-success' : 'text-danger',
            )}
            role="status"
          >
            {status.kind === 'success' ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <CircleAlert className="size-4" />
            )}
            {status.message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
