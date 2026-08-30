import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type {
  AccountSummary,
  MailFolderSummary,
  MailMessageSummary,
  MailWindowContext,
  MessageMoveDestination,
} from '../shared/accounts';
import { groupMessagesWithRelated, type MailConversation } from '../shared/conversations';
import { ComposeDialog, type DraftSavedEvent } from './features/compose-dialog';
import { ConversationReader } from './features/conversation-reader';
import {
  conversationWithFlaggedValues,
  conversationWithMessage,
  conversationWithUnreadValues,
  performConversationAction,
  type ConversationAction,
  type FolderSelection,
} from './features/mail-common';

export const mailEventsChannel = 'emzero-mail-events';

function notifyMailChanged(): void {
  const channel = new BroadcastChannel(mailEventsChannel);
  channel.postMessage({ type: 'changed' });
  channel.close();
}

function notifyDraftSaved(event: DraftSavedEvent): void {
  const channel = new BroadcastChannel(mailEventsChannel);
  channel.postMessage({ type: 'draft-saved', event });
  channel.close();
}

export function parsedMailWindowId(): string | null {
  const prefix = '#mail-window=';
  if (!window.location.hash.startsWith(prefix)) return null;
  const value = window.location.hash.slice(prefix.length);
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function LoadingWindow({ message = 'Loading mail…' }: { message?: string }) {
  return (
    <main className="grid h-screen place-items-center bg-background text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        {message}
      </div>
    </main>
  );
}

function ComposerWindow({ context }: { context: Extract<MailWindowContext, { kind: 'composer' }> }) {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  useEffect(() => {
    void window.emzero.accounts.list().then(setAccounts).catch(() => setAccounts([]));
  }, []);
  if (!accounts) return <LoadingWindow />;
  return (
    <ComposeDialog
      open
      accounts={accounts}
      defaultAccountId={context.accountId}
      composerKind={context.composerKind}
      variant="window"
      initialDraft={context.draft}
      initialDraftReference={context.draftReference}
      onOpenChange={(open) => { if (!open) window.close(); }}
      onDraftSaved={notifyDraftSaved}
      onSent={notifyMailChanged}
      onDeleted={notifyMailChanged}
    />
  );
}

type MessageWindowState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'loaded';
      accounts: AccountSummary[];
      selection: FolderSelection;
      folders: MailFolderSummary[];
      conversation: MailConversation;
    };

function MessageWindow({ context }: { context: Extract<MailWindowContext, { kind: 'message' }> }) {
  const [state, setState] = useState<MessageWindowState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const accounts = await window.emzero.accounts.list();
      const account = accounts.find((candidate) => candidate.id === context.accountId);
      if (!account) throw new Error('Account not found.');
      const folderResult = await window.emzero.folders.list(account.id);
      if (!folderResult.ok) throw new Error(folderResult.message ?? 'Could not load folders.');
      const folder = folderResult.folders.find((candidate) => candidate.path === context.folderPath);
      if (!folder) throw new Error('Folder not found.');
      const primaryResult = await window.emzero.messages.list(account.id, folder.path);
      if (!primaryResult.ok) throw new Error(primaryResult.message ?? 'Could not load messages.');
      const primary = primaryResult.messages.map((message) => ({ ...message, folderPath: folder.path }));
      const relatedFolders = folderResult.folders.filter((candidate) =>
        candidate.selectable && candidate.path !== folder.path &&
        ['\\Inbox', '\\Sent', '\\Drafts'].includes(candidate.specialUse ?? ''),
      );
      const relatedResults = await Promise.all(relatedFolders.map(async (candidate) => ({
        folder: candidate,
        result: await window.emzero.messages.list(account.id, candidate.path),
      })));
      const related = relatedResults.flatMap(({ folder: candidate, result }) => result.ok
        ? result.messages.map((message) => ({ ...message, folderPath: candidate.path }))
        : []);
      const conversation = groupMessagesWithRelated(primary, related).find(({ messages }) =>
        messages.some((message) => message.folderPath === context.folderPath && message.uid === context.uid),
      );
      if (!conversation) throw new Error('Conversation not found.');
      if (active) {
        setState({
          status: 'loaded',
          accounts,
          selection: { kind: 'folder', account, folder },
          folders: folderResult.folders,
          conversation,
        });
      }
    })().catch((error: unknown) => {
      if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load conversation.' });
    });
    return () => { active = false; };
  }, [context.accountId, context.folderPath, context.uid]);

  if (state.status === 'loading') return <LoadingWindow />;
  if (state.status === 'error') {
    return <main className="grid h-screen place-items-center bg-background p-8 text-center text-sm text-danger">{state.message}</main>;
  }

  const runAction = async (action: ConversationAction, destination?: MessageMoveDestination) => {
    setBusy(true);
    setActionError(null);
    try {
      const error = await performConversationAction(
        state.selection.account.id,
        state.selection.folder.path,
        state.conversation,
        action,
        destination,
      );
      if (error) {
        setActionError(error);
        return;
      }
      notifyMailChanged();
      if (action === 'delete' || action === 'move') {
        window.close();
        return;
      }
      const values = new Map(state.conversation.messages
        .filter((message) => message.folderPath === state.selection.folder.path)
        .map((message) => [`${message.folderPath}:${message.uid}`, action === 'unread' || action === 'star']));
      setState((current) => current.status === 'loaded'
        ? {
            ...current,
            conversation: action === 'read' || action === 'unread'
              ? conversationWithUnreadValues(current.conversation, values)
              : conversationWithFlaggedValues(current.conversation, values),
          }
        : current);
    } catch {
      setActionError('The action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="h-screen bg-background text-foreground">
      <ConversationReader
        accounts={state.accounts}
        selection={state.selection}
        folders={state.folders}
        conversation={state.conversation}
        onBack={() => window.close()}
        navigationVariant="close"
        nativeWindow
        busy={busy}
        actionError={actionError}
        onSetUnread={(value) => void runAction(value ? 'unread' : 'read')}
        onSetFlagged={(value) => void runAction(value ? 'star' : 'unstar')}
        onMove={(destination) => void runAction('move', destination)}
        onDelete={() => void runAction('delete')}
        onReplySent={(message: MailMessageSummary) => {
          setState((current) => current.status === 'loaded'
            ? { ...current, conversation: conversationWithMessage(current.conversation, message) }
            : current);
          notifyMailChanged();
        }}
        onDraftSent={() => window.close()}
      />
    </main>
  );
}

export function MailWindow({ context }: { context: MailWindowContext }) {
  return context.kind === 'composer'
    ? <ComposerWindow context={context} />
    : <MessageWindow context={context} />;
}

export function MailWindowBootstrap({ windowId }: { windowId: string }) {
  const [context, setContext] = useState<MailWindowContext | null | undefined>(undefined);
  useEffect(() => {
    void window.emzero.getMailWindowContext(windowId).then(setContext).catch(() => setContext(null));
  }, [windowId]);
  if (context === undefined) return <LoadingWindow />;
  if (context === null) {
    return <main className="grid h-screen place-items-center bg-background p-8 text-sm text-danger">This mail window is no longer available.</main>;
  }
  return <MailWindow context={context} />;
}
