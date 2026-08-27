import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent } from 'react';
import { LoaderCircle, Menu, PanelLeftOpen } from 'lucide-react';
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

const sidebarWidthStorageKey = 'emzero.sidebar-width';
const sidebarPinnedStorageKey = 'emzero.sidebar-pinned';
const mailLayoutStorageKey = 'emzero.mail-layout';
const minimumSidebarWidth = 200;
const maximumSidebarWidth = 420;

type MailLayout = 'list' | 'split';

function storedSidebarWidth(): number {
  const stored = window.localStorage.getItem(sidebarWidthStorageKey);
  if (stored === null) return 240;
  const value = Number(stored);
  return Number.isFinite(value)
    ? Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, value))
    : 240;
}

export function App() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const [sidebarPinned, setSidebarPinned] = useState(
    () => window.localStorage.getItem(sidebarPinnedStorageKey) !== 'false',
  );
  const [mailLayout, setMailLayout] = useState<MailLayout>(
    () => window.localStorage.getItem(mailLayoutStorageKey) === 'split' ? 'split' : 'list',
  );
  const [selection, setSelection] = useState<MailboxSelection>({ kind: 'unified' });
  const [syncStatus, setSyncStatus] = useState<MailSyncStatus>({
    state: 'idle',
    lastSyncedAt: null,
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [bulkOperation, setBulkOperation] = useState<BulkOperationView | null>(null);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(sidebarPinnedStorageKey, String(sidebarPinned));
  }, [sidebarPinned]);

  useEffect(() => {
    window.localStorage.setItem(mailLayoutStorageKey, mailLayout);
  }, [mailLayout]);

  const startSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const resize = (moveEvent: globalThis.PointerEvent) => {
      setSidebarWidth(
        Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, startWidth + moveEvent.clientX - startX)),
      );
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish, { once: true });
  };

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
    <main
      className="grid h-screen grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      style={{ '--sidebar-width': sidebarPinned ? `${sidebarWidth}px` : '0px' } as CSSProperties}
    >
      {sidebarPinned && (
        <div className="relative hidden min-h-0 min-w-0 lg:flex">
          <Sidebar
            className="min-w-0 flex-1 border-r-0"
            accounts={accounts}
            selection={selection}
            syncStatus={syncStatus}
            syncRevision={syncRevision}
            onUnpin={() => setSidebarPinned(false)}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
              setShowSetup(false);
            }}
            onAdd={() => setShowSetup(true)}
            onManage={() => setSettingsOpen(true)}
            onReorder={async (accountIds) => {
              const previous = accounts;
              const byId = new Map(accounts.map((account) => [account.id, account]));
              setAccounts(accountIds.flatMap((id) => byId.get(id) ?? []));
              try {
                const result = await window.emzero.accounts.reorder(accountIds);
                if (!result.ok || !result.accounts) {
                  setAccounts(previous);
                  return false;
                }
                setAccounts(result.accounts);
                return true;
              } catch {
                setAccounts(previous);
                return false;
              }
            }}
            onCompose={() => setComposeOpen(true)}
          />
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize navigation"
            aria-orientation="vertical"
            aria-valuemin={minimumSidebarWidth}
            aria-valuemax={maximumSidebarWidth}
            aria-valuenow={sidebarWidth}
            className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/35"
            onPointerDown={startSidebarResize}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              setSidebarWidth((current) => Math.min(
                maximumSidebarWidth,
                Math.max(minimumSidebarWidth, current + (event.key === 'ArrowRight' ? 16 : -16)),
              ));
            }}
          />
        </div>
      )}
      {!sidebarPinned && <div className="hidden lg:block" aria-hidden="true" />}
      {!sidebarPinned && (
        <Button
          variant="secondary"
          className="fixed left-3 top-3 z-40 hidden size-10 border border-border bg-card px-0 shadow-sm lg:flex"
          aria-label="Pin navigation"
          title="Pin navigation"
          onClick={() => setSidebarPinned(true)}
        >
          <PanelLeftOpen className="size-5" />
        </Button>
      )}
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
            onReorder={async (accountIds) => {
              const previous = accounts;
              const byId = new Map(accounts.map((account) => [account.id, account]));
              setAccounts(accountIds.flatMap((id) => byId.get(id) ?? []));
              try {
                const result = await window.emzero.accounts.reorder(accountIds);
                if (!result.ok || !result.accounts) {
                  setAccounts(previous);
                  return false;
                }
                setAccounts(result.accounts);
                return true;
              } catch {
                setAccounts(previous);
                return false;
              }
            }}
            onCompose={() => {
              setComposeOpen(true);
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      <ComposeDialog
        open={composeOpen}
        accounts={accounts}
        defaultAccountId={
          selection.kind === 'folder' ? selection.account.id : (accounts[0]?.id ?? null)
        }
        onOpenChange={setComposeOpen}
        onSent={() => setSyncRevision((current) => current + 1)}
      />
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
          accounts={accounts}
          selection={selection}
          onStartBulkOperation={startBulkOperation}
          mailLayout={mailLayout}
          onMailLayoutChange={setMailLayout}
        />
      ) : selection.kind === 'search' ? (
        <MailSearch
          accounts={accounts}
          initialQuery={selection.query}
          mailLayout={mailLayout}
          onMailLayoutChange={setMailLayout}
        />
      ) : (
        <UnifiedInbox
          key={`${selection.mailbox ?? 'inbox'}:${syncRevision}`}
          accounts={accounts}
          mailbox={selection.mailbox ?? 'inbox'}
          onStartBulkOperation={startBulkOperation}
          mailLayout={mailLayout}
          onMailLayoutChange={setMailLayout}
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
