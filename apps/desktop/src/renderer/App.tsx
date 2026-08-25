import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type {
  AccountSummary,
  BulkMessageJobRequest,
  MailProvider,
  MailSyncStatus,
} from '../shared/accounts';
import { AccountSetup } from './features/account-setup';
import { AccountSettingsDialog } from './features/account-settings';
import {
  BulkOperationBar,
  type BulkOperationView,
} from './features/bulk-operation';
import { ComposeDialog } from './features/compose-dialog';
import { MailSearch } from './features/mail-search';
import {
  type MailboxSelection,
  type StartBulkOperation,
} from './features/mail-common';
import { MessageList } from './features/message-list';
import { Sidebar } from './features/sidebar';
import { UnifiedInbox } from './features/unified-inbox';

export function App() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selection, setSelection] = useState<MailboxSelection>({ kind: 'unified' });
  const [syncStatus, setSyncStatus] = useState<MailSyncStatus>({
    state: 'idle',
    lastSyncedAt: null,
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [bulkOperation, setBulkOperation] = useState<BulkOperationView | null>(null);

  useEffect(() => {
    void Promise.allSettled([window.emzero.accounts.list(), window.emzero.providers.list()]).then(
      ([accountsResult, providersResult]) => {
        const loadedAccounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
        setAccounts(loadedAccounts);
        setShowSetup(loadedAccounts.length === 0);
        if (providersResult.status === 'fulfilled') setProviders(providersResult.value);
      },
    );
  }, []);

  useEffect(
    () =>
      window.emzero.messages.onBulkJobProgress((progress) => {
        setBulkOperation((current) => {
          if (!current) return current;
          const processedKeys = new Set(current.processedKeys);
          if (progress.accountId && progress.folderPath && progress.processedUids) {
            for (const uid of progress.processedUids) {
              processedKeys.add(`${progress.accountId}:${progress.folderPath}:${uid}`);
            }
          }
          return { ...current, progress, processedKeys };
        });
        if (['completed', 'stopped', 'error'].includes(progress.state)) {
          setSyncRevision((current) => current + 1);
        }
      }),
    [],
  );

  useEffect(() => {
    if (bulkOperation?.progress.state !== 'completed') return;
    const timer = window.setTimeout(() => setBulkOperation(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [bulkOperation?.progress.state]);

  const startBulkOperation = useCallback<StartBulkOperation>(async (request, location) => {
    if (
      bulkOperation?.progress.state === 'running' ||
      bulkOperation?.progress.state === 'stopping'
    ) {
      return { ok: false, message: 'Another bulk message action is already running.' };
    }
    const total = request.groups.reduce((sum, group) => sum + group.uids.length, 0);
    setBulkOperation({
      location,
      request,
      processedKeys: new Set(),
      progress: {
        jobId: 'starting',
        action: request.action,
        state: 'running',
        total,
        processed: 0,
      },
    });
    try {
      const result = await window.emzero.messages.startBulkJob(request);
      if (!result.ok || !result.jobId) {
        setBulkOperation(null);
        return result;
      }
      setBulkOperation((current) =>
        current
          ? { ...current, progress: { ...current.progress, jobId: result.jobId! } }
          : current,
      );
      return result;
    } catch {
      setBulkOperation(null);
      return { ok: false, message: 'The bulk action could not be started.' };
    }
  }, [bulkOperation?.progress.state]);

  useEffect(() => {
    void window.emzero.sync.status().then(setSyncStatus).catch(() => undefined);
    return window.emzero.sync.onStatus((status) => {
      setSyncStatus(status);
      if (status.state !== 'syncing') setSyncRevision((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    const desktopLayout = window.matchMedia('(min-width: 64rem)');
    const closeCompactSidebar = (event: MediaQueryListEvent) => {
      if (event.matches) setSidebarOpen(false);
    };
    desktopLayout.addEventListener('change', closeCompactSidebar);
    return () => desktopLayout.removeEventListener('change', closeCompactSidebar);
  }, []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key.toLowerCase() !== 'k' ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      setShowSetup(false);
      setSelection((current) =>
        current.kind === 'search' ? current : { kind: 'search', query: '' },
      );
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('[data-mail-search]')?.focus();
      });
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  if (accounts === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading accounts" />
      </main>
    );
  }

  return (
    <main className="grid h-screen grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Sidebar
        className="hidden lg:flex"
        accounts={accounts}
        selection={selection}
        syncStatus={syncStatus}
        syncRevision={syncRevision}
        onSelect={(nextSelection) => {
          setSelection(nextSelection);
          setShowSetup(false);
        }}
        onAdd={() => setShowSetup(true)}
        onManage={() => setSettingsOpen(true)}
        onCompose={() => setComposeOpen(true)}
      />
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger asChild>
          <Button
            variant="secondary"
            className="fixed left-3 top-3 z-40 size-10 border border-border bg-card px-0 shadow-sm lg:hidden"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent className="p-0 lg:hidden">
          <div className="sr-only">
            <SheetTitle>Mail navigation</SheetTitle>
            <SheetDescription>Choose an inbox, folder, or account action.</SheetDescription>
          </div>
          <Sidebar
            className="h-full border-r-0"
            accounts={accounts}
            selection={selection}
            syncStatus={syncStatus}
            syncRevision={syncRevision}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
              setShowSetup(false);
              setSidebarOpen(false);
            }}
            onAdd={() => {
              setShowSetup(true);
              setSidebarOpen(false);
            }}
            onManage={() => {
              setSettingsOpen(true);
              setSidebarOpen(false);
            }}
            onCompose={() => {
              setComposeOpen(true);
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      {composeOpen && (
        <ComposeDialog
          open
          accounts={accounts}
          defaultAccountId={
            selection.kind === 'folder' ? selection.account.id : (accounts[0]?.id ?? null)
          }
          onOpenChange={setComposeOpen}
          onSent={() => setSyncRevision((current) => current + 1)}
        />
      )}
      <AccountSettingsDialog
        open={settingsOpen}
        accounts={accounts}
        onOpenChange={setSettingsOpen}
        onUpdated={(updatedAccount) => {
          setAccounts((current) =>
            current?.map((account) =>
              account.id === updatedAccount.id ? updatedAccount : account,
            ) ?? [],
          );
          setSelection((current) =>
            current.kind === 'folder' && current.account.id === updatedAccount.id
              ? { ...current, account: updatedAccount }
              : current,
          );
        }}
        onRemoved={(accountId) => {
          const remainingAccounts = accounts.filter((account) => account.id !== accountId);
          setAccounts(remainingAccounts);
          setSelection((current) =>
            current.kind === 'folder' && current.account.id === accountId
              ? { kind: 'unified' }
              : current,
          );
          if (remainingAccounts.length === 0) {
            setSettingsOpen(false);
            setShowSetup(true);
          }
        }}
      />
      {showSetup ? (
        <AccountSetup
          providers={providers}
          canCancel={accounts.length > 0}
          onCancel={() => setShowSetup(false)}
          onSaved={(account) => {
            setAccounts((current) => [...(current ?? []), account]);
            setShowSetup(false);
          }}
        />
      ) : selection.kind === 'folder' ? (
        <MessageList
          key={`${selection.account.id}:${selection.folder.path}:${syncRevision}`}
          selection={selection}
          onStartBulkOperation={startBulkOperation}
        />
      ) : selection.kind === 'search' ? (
        <MailSearch
          accounts={accounts}
          initialQuery={selection.query}
        />
      ) : (
        <UnifiedInbox
          key={syncRevision}
          accounts={accounts}
          onStartBulkOperation={startBulkOperation}
        />
      )}
      {bulkOperation && (
        <BulkOperationBar
          operation={bulkOperation}
          onStop={() => {
            void window.emzero.messages.cancelBulkJob(bulkOperation.progress.jobId);
          }}
          onRetry={() => {
            const request: BulkMessageJobRequest = {
              ...bulkOperation.request,
              groups: bulkOperation.request.groups
                .map((group) => ({
                  ...group,
                  uids: group.uids.filter(
                    (uid) =>
                      !bulkOperation.processedKeys.has(
                        `${group.accountId}:${group.folderPath}:${uid}`,
                      ),
                  ),
                }))
                .filter((group) => group.uids.length > 0),
            };
            void startBulkOperation(request, bulkOperation.location);
          }}
          onDismiss={() => setBulkOperation(null)}
        />
      )}
    </main>
  );
}
