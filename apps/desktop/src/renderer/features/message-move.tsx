import { useState } from 'react';
import { Folder, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  displayFolderName,
  type AccountSummary,
  type MailFolderSummary,
  type MessageMoveDestination,
} from '../../shared/accounts';

export function MoveToDialog({
  accounts,
  sourceAccountId,
  sourceFolders,
  sourcePath,
  sourceLocations,
  count,
  busy,
  compact = false,
  menuItem = false,
  onTrigger,
  onMove,
}: {
  accounts: AccountSummary[];
  sourceAccountId: string;
  sourceFolders: MailFolderSummary[];
  sourcePath: string;
  sourceLocations?: MessageMoveDestination[];
  count: number;
  busy: boolean;
  compact?: boolean;
  menuItem?: boolean;
  onTrigger?: () => void;
  onMove: (destination: MessageMoveDestination) => void;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(sourceAccountId);
  const [destinationPath, setDestinationPath] = useState('');
  const [folderStates, setFolderStates] = useState<Record<string, {
    status: 'loading' | 'loaded' | 'error';
    folders: MailFolderSummary[];
    message?: string;
  }>>({});

  const loadAccountFolders = (nextAccountId: string) => {
    if (nextAccountId === sourceAccountId || folderStates[nextAccountId]) return;
    setFolderStates((current) => ({
      ...current,
      [nextAccountId]: { status: 'loading', folders: [] },
    }));
    void window.emzero.folders.list(nextAccountId).then((result) => {
      setFolderStates((current) => ({
        ...current,
        [nextAccountId]: result.ok
          ? { status: 'loaded', folders: result.folders }
          : {
              status: 'error',
              folders: [],
              message: result.message ?? 'Could not load folders for this account.',
            },
      }));
    }).catch(() => {
      setFolderStates((current) => ({
        ...current,
        [nextAccountId]: {
          status: 'error',
          folders: [],
          message: 'Could not load folders for this account.',
        },
      }));
    });
  };

  const folders = accountId === sourceAccountId
    ? sourceFolders
    : (folderStates[accountId]?.folders ?? []);
  const loading = folderStates[accountId]?.status === 'loading';
  const loadError = folderStates[accountId]?.status === 'error'
    ? folderStates[accountId].message
    : null;
  const excludedPaths = new Set(
    (sourceLocations ?? [{ accountId: sourceAccountId, folderPath: sourcePath }])
      .filter((source) => source.accountId === accountId)
      .map((source) => source.folderPath),
  );
  const destinations = folders.filter(
    (folder) => folder.selectable && !excludedPaths.has(folder.path),
  );
  const effectiveDestinationPath = destinations.some(
    (folder) => folder.path === destinationPath,
  )
    ? destinationPath
    : (destinations[0]?.path ?? '');

  return (
    <>
      <Button
        variant="ghost"
        className={menuItem ? 'h-8 w-full justify-start rounded-md px-2 text-xs' : compact ? 'size-8 px-0' : 'px-3'}
        role={menuItem ? 'menuitem' : undefined}
        aria-label="Move to folder"
        title="Move to folder"
        disabled={busy || accounts.length === 0}
        onClick={() => {
          onTrigger?.();
          setOpen(true);
        }}
      >
        <Folder className="size-4" />
        {menuItem ? 'Move to folder' : !compact && <span className="hidden sm:inline">Move to</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {count === 1 ? 'email' : `${count} emails`}</DialogTitle>
            <DialogDescription>Choose a destination account and folder.</DialogDescription>
          </DialogHeader>
          <label className="mt-2 block text-sm font-medium">
            <span className="mb-2 block">Account</span>
            <select
              className="field"
              value={accountId}
              onChange={(event) => {
                const nextAccountId = event.target.value;
                setAccountId(nextAccountId);
                setDestinationPath('');
                loadAccountFolders(nextAccountId);
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.email}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-sm font-medium">
            <span className="mb-2 block">Folder</span>
            <select
              className="field"
              value={effectiveDestinationPath}
              disabled={loading || destinations.length === 0}
              onChange={(event) => setDestinationPath(event.target.value)}
            >
              {destinations.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {displayFolderName(folder)}
                </option>
              ))}
            </select>
          </label>
          {loading && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading folders
            </p>
          )}
          {loadError && <p className="mt-2 text-xs text-danger">{loadError}</p>}
          {!loadError && !loading && destinations.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              This account has no other selectable folder.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!effectiveDestinationPath || loading}
              onClick={() => {
                onMove({ accountId, folderPath: effectiveDestinationPath });
                setOpen(false);
              }}
            >
              Move
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
