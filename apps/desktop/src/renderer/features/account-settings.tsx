import {
  useState,
} from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Download,
  LoaderCircle,
  Trash2,
  Upload,
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
  onImported,
}: {
  open: boolean;
  accounts: AccountSummary[];
  onOpenChange: (open: boolean) => void;
  onUpdated: (account: AccountSummary) => void;
  onRemoved: (accountId: string) => void;
  onImported: (accounts: AccountSummary[]) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [exportPassword, setExportPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedBackup, setSelectedBackup] = useState<{ id: string; fileName: string } | null>(null);
  const [includeCredentials, setIncludeCredentials] = useState(true);
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);

  const exportBackup = async () => {
    if (exportPassword.length < 8) {
      setStatus({ kind: 'error', message: 'Use a backup password with at least 8 characters.' });
      return;
    }
    if (exportPassword !== confirmPassword) {
      setStatus({ kind: 'error', message: 'The backup passwords do not match.' });
      return;
    }
    setBackupBusy('export');
    setStatus(null);
    try {
      const result = await window.emzero.accounts.exportBackup({ password: exportPassword, includeCredentials });
      if (!result.canceled) setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
    } catch {
      setStatus({ kind: 'error', message: 'The account backup could not be exported.' });
    } finally {
      setBackupBusy(null);
    }
  };

  const importBackup = async () => {
    if (!selectedBackup) {
      setStatus({ kind: 'error', message: 'Choose an Emzero backup file first.' });
      return;
    }
    if (!importPassword) {
      setStatus({ kind: 'error', message: 'Enter the password used to encrypt the backup.' });
      return;
    }
    setBackupBusy('import');
    setStatus(null);
    try {
      const result = await window.emzero.accounts.importBackup({
        selectionId: selectedBackup.id,
        password: importPassword,
      });
      if (result.ok && result.accounts) {
        onImported(result.accounts);
        setSelectedBackup(null);
        setImportPassword('');
      }
      if (!result.canceled) setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
    } catch {
      setStatus({ kind: 'error', message: 'The account backup could not be imported.' });
    } finally {
      setBackupBusy(null);
    }
  };

  const chooseBackup = async () => {
    setBackupBusy('import');
    setStatus(null);
    try {
      const result = await window.emzero.accounts.selectBackup();
      if (result.ok && result.selectionId && result.fileName) {
        setSelectedBackup({ id: result.selectionId, fileName: result.fileName });
        setImportPassword('');
      } else if (!result.canceled) {
        setStatus({ kind: 'error', message: result.message });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The backup file could not be selected.' });
    } finally {
      setBackupBusy(null);
    }
  };

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
            Rename, remove, back up, or restore your connected accounts.
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

        <section className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">Export backup</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Save account settings in a password-encrypted file. Keep this password safe;
                Emzero cannot recover it.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className="sr-only">Backup password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder="Backup password"
                value={exportPassword}
                disabled={backupBusy !== null}
                onChange={(event) => setExportPassword(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Confirm backup password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm for export"
                value={confirmPassword}
                disabled={backupBusy !== null}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeCredentials}
              disabled={backupBusy !== null}
              onChange={(event) => setIncludeCredentials(event.target.checked)}
            />
            <span>
              Include passwords and sign-in tokens. Required for instant restoration on another device.
            </span>
          </label>
          {!includeCredentials && (
            <p className="text-xs text-warning">
              Settings-only backups cannot restore accounts until credentials are included.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={backupBusy !== null} onClick={() => void exportBackup()}>
              {backupBusy === 'export' ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              Export backup
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <Upload className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">Import backup</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose an Emzero backup from another device, then enter the password used to encrypt it.
              </p>
            </div>
          </div>
          <Button type="button" variant="secondary" disabled={backupBusy !== null} onClick={() => void chooseBackup()}>
            {backupBusy === 'import' && !selectedBackup
              ? <LoaderCircle className="size-4 animate-spin" />
              : <Upload className="size-4" />}
            {selectedBackup ? 'Choose another file' : 'Choose backup file'}
          </Button>
          {selectedBackup && (
            <div className="space-y-2">
              <p className="truncate text-xs text-muted-foreground" title={selectedBackup.fileName}>
                Selected: {selectedBackup.fileName}
              </p>
              <label className="block">
                <span className="sr-only">Backup password</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Backup password"
                  value={importPassword}
                  disabled={backupBusy !== null}
                  onChange={(event) => setImportPassword(event.target.value)}
                />
              </label>
              <Button type="button" variant="secondary" disabled={backupBusy !== null} onClick={() => void importBackup()}>
                {backupBusy === 'import' ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Import accounts
              </Button>
            </div>
          )}
        </section>

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
