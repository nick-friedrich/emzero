import {
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Archive,
  CalendarDays,
  Flag,
  Folder,
  Mail,
  MailOpen,
  MoreHorizontal,
  Palette,
  Star,
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
  type MailFolderSummary,
  type MessageMoveDestination,
  findArchiveFolder,
} from '../../shared/accounts';
import {
  EMZERO_MESSAGE_COLORS,
  localDateKeyAfter,
  tomorrowDateKey,
  type EmzeroMessageColor,
} from '../../shared/message-keywords';
import {
  dueDateLabel,
  messageColorBackgroundClass,
  messageColorTextClass,
} from './mail-common';
import { MoveToDialog } from './message-move';

/**
 * Inline read/delete buttons plus the "More" button, which opens a modal with
 * every conversation action. List rows also open that modal on right-click by
 * controlling `actionsOpen`.
 */
export function ConversationActions({
  accounts,
  sourceAccountId,
  folders,
  sourcePath,
  messageCount,
  subject,
  unread,
  flagged,
  important,
  dueDate,
  color,
  supportsEmzeroKeywords,
  busy,
  confirmPermanentDelete,
  onSetUnread,
  onSetFlagged,
  onSetImportant,
  onSetColor,
  onMove,
  onDelete,
  deleteButtonRef,
  leadingAction,
  actionsOpen: controlledActionsOpen,
  onActionsOpenChange,
}: {
  accounts: AccountSummary[];
  sourceAccountId: string;
  folders: MailFolderSummary[];
  sourcePath: string;
  messageCount: number;
  subject?: string;
  unread: boolean;
  flagged: boolean;
  important: boolean;
  dueDate: string | null;
  color: EmzeroMessageColor | null;
  supportsEmzeroKeywords: boolean;
  busy: boolean;
  confirmPermanentDelete: boolean;
  onSetUnread: (unread: boolean) => void;
  onSetFlagged: (flagged: boolean) => void;
  onSetImportant: (important: boolean, dueDate?: string) => void;
  onSetColor: (color: EmzeroMessageColor | null) => void;
  onMove: (destination: MessageMoveDestination) => void;
  onDelete: () => void;
  deleteButtonRef?: Ref<HTMLButtonElement>;
  leadingAction?: ReactNode;
  actionsOpen?: boolean;
  onActionsOpenChange?: (open: boolean) => void;
}) {
  const [dueDialogOpen, setDueDialogOpen] = useState(false);
  const [colorDialogOpen, setColorDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [uncontrolledActionsOpen, setUncontrolledActionsOpen] = useState(false);
  const [customDueDate, setCustomDueDate] = useState(dueDate ?? tomorrowDateKey());
  const actionsOpen = controlledActionsOpen ?? uncontrolledActionsOpen;
  const setActionsOpen = (open: boolean) => {
    if (controlledActionsOpen === undefined) setUncontrolledActionsOpen(open);
    onActionsOpenChange?.(open);
  };
  const archive = findArchiveFolder(folders);
  const unreadLabel = unread ? 'Mark as read' : 'Mark as unread';

  const requestDelete = () => {
    if (confirmPermanentDelete) setDeleteConfirmOpen(true);
    else onDelete();
  };
  const runAction = (action: () => void) => {
    setActionsOpen(false);
    action();
  };
  const actionItemClass = 'h-10 w-full justify-start gap-3 rounded-lg px-3 text-sm';
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="Conversation actions">
      {leadingAction}
      <Button
        variant="ghost"
        className="size-8 px-0"
        aria-label={unreadLabel}
        title={unreadLabel}
        disabled={busy}
        onClick={() => onSetUnread(!unread)}
      >
        {unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
      </Button>
      <Button
        ref={deleteButtonRef}
        variant="ghost"
        className="size-8 px-0 text-danger hover:text-danger"
        aria-label="Delete conversation"
        title="Delete conversation"
        onClick={requestDelete}
      >
        <Trash2 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        className="size-8 px-0"
        aria-label="More conversation actions"
        title="More conversation actions"
        aria-haspopup="dialog"
        aria-expanded={actionsOpen}
        disabled={busy}
        onClick={() => setActionsOpen(true)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
        <DialogContent className="w-[min(22rem,calc(100%-2rem))] gap-4 p-4">
          <DialogHeader className="px-1 pt-1">
            <DialogTitle className="text-base">Conversation actions</DialogTitle>
            <DialogDescription className={cn('truncate', !subject && 'sr-only')}>
              {subject || 'Choose an action for this conversation.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-0.5">
            <Button
              autoFocus
              variant="ghost"
              className={actionItemClass}
              disabled={busy}
              onClick={() => runAction(() => onSetUnread(!unread))}
            >
              {unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
              {unreadLabel}
            </Button>
            <Button
              variant="ghost"
              className={actionItemClass}
              disabled={busy}
              onClick={() => runAction(() => onSetFlagged(!flagged))}
            >
              <Star className={cn('size-4', flagged && 'fill-primary text-primary')} />
              {flagged ? 'Remove star' : 'Add star'}
            </Button>
            {supportsEmzeroKeywords && (
              <>
                <Button
                  variant="ghost"
                  className={actionItemClass}
                  disabled={busy}
                  onClick={() => runAction(() => onSetImportant(!important))}
                >
                  <Flag className={cn('size-4', important && 'fill-danger text-danger')} />
                  {important ? 'Remove important' : 'Mark important'}
                </Button>
                <Button
                  variant="ghost"
                  className={cn(actionItemClass, dueDate && 'h-auto py-2')}
                  disabled={busy}
                  onClick={() => runAction(() => {
                    setCustomDueDate(dueDate ?? tomorrowDateKey());
                    setDueDialogOpen(true);
                  })}
                >
                  <CalendarDays className="size-4" />
                  <span className="min-w-0 text-left">
                    <span className="block">{dueDate ? dueDateLabel(dueDate) : 'Set due date'}</span>
                    {dueDate && (
                      <span className="block text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${dueDate}T00:00:00`))}
                      </span>
                    )}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  className={actionItemClass}
                  disabled={busy}
                  onClick={() => runAction(() => setColorDialogOpen(true))}
                >
                  <Palette className={cn('size-4', color && messageColorTextClass(color))} />
                  {color ? 'Change color' : 'Assign color'}
                </Button>
              </>
            )}
            <div className="my-1 h-px bg-border" role="separator" />
            {archive && archive.path !== sourcePath && (
              <Button
                variant="ghost"
                className={actionItemClass}
                disabled={busy}
                onClick={() => runAction(() => onMove({ accountId: sourceAccountId, folderPath: archive.path }))}
              >
                <Archive className="size-4" />
                Archive
              </Button>
            )}
            <Button
              variant="ghost"
              className={actionItemClass}
              disabled={busy || accounts.length === 0}
              onClick={() => runAction(() => setMoveDialogOpen(true))}
            >
              <Folder className="size-4" />
              Move to folder
            </Button>
            <Button
              variant="ghost"
              className={cn(actionItemClass, 'text-danger hover:text-danger')}
              disabled={busy}
              onClick={() => runAction(requestDelete)}
            >
              <Trash2 className="size-4" />
              {confirmPermanentDelete ? 'Delete permanently' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmPermanentDelete && (
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete this conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                This conversation will be permanently removed and cannot be recovered.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Permanently delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <MoveToDialog
        accounts={accounts}
        sourceAccountId={sourceAccountId}
        sourceFolders={folders}
        sourcePath={sourcePath}
        count={messageCount}
        busy={busy}
        hideTrigger
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        onMove={onMove}
      />
      {supportsEmzeroKeywords && (
        <>
          <Dialog open={dueDialogOpen} onOpenChange={(open) => {
            setDueDialogOpen(open);
            if (open) setCustomDueDate(dueDate ?? tomorrowDateKey());
          }}>
            <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
              <DialogHeader>
                <DialogTitle>Set due date</DialogTitle>
                <DialogDescription>Mark this conversation as important and choose when it is due.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Today', localDateKeyAfter(0)],
                  ['Tomorrow', localDateKeyAfter(1)],
                  ['Next week', localDateKeyAfter(7)],
                ].map(([label, value]) => (
                  <Button key={label} variant="secondary" onClick={() => { onSetImportant(true, value); setDueDialogOpen(false); }}>
                    {label}
                  </Button>
                ))}
              </div>
              <label className="space-y-2 text-sm font-medium">
                <span className="block">Custom date</span>
                <input type="date" className="field" value={customDueDate} onChange={(event) => setCustomDueDate(event.target.value)} />
              </label>
              <div className="flex justify-between gap-2">
                {important ? <Button variant="ghost" onClick={() => { onSetImportant(false); setDueDialogOpen(false); }}>Remove important</Button> : <span />}
                <Button disabled={!customDueDate} onClick={() => { onSetImportant(true, customDueDate); setDueDialogOpen(false); }}>Set due date</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={colorDialogOpen} onOpenChange={setColorDialogOpen}>
            <DialogContent className="w-[min(25rem,calc(100%-2rem))]">
              <DialogHeader>
                <DialogTitle>Assign color</DialogTitle>
                <DialogDescription>Choose a color that will synchronize with other Emzero clients.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {EMZERO_MESSAGE_COLORS.map((candidate) => (
                  <Button key={candidate} variant={candidate === color ? 'default' : 'secondary'} className="justify-start capitalize" onClick={() => { onSetColor(candidate); setColorDialogOpen(false); }}>
                    <span className={cn('size-3 rounded-full', messageColorBackgroundClass(candidate))} />
                    {candidate}
                  </Button>
                ))}
              </div>
              {color && <Button variant="ghost" onClick={() => { onSetColor(null); setColorDialogOpen(false); }}>Remove color</Button>}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
