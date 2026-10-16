import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { orderedFolderTree, type AccountSummary, type MailFolderSummary } from '../../shared/accounts';
import { Field } from './form-field';

export type FolderEditorState =
  | { kind: 'create'; account: AccountSummary; parentPath: string }
  | { kind: 'rename'; account: AccountSummary; folder: MailFolderSummary };

export function FolderEditorDialog({
  state,
  folders,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  state: FolderEditorState;
  folders: MailFolderSummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, parentPath: string) => void;
}) {
  const [name, setName] = useState(state.kind === 'rename' ? state.folder.name : '');
  const [parentPath, setParentPath] = useState(
    state.kind === 'create' ? state.parentPath : state.folder.parentPath,
  );
  const create = state.kind === 'create';

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{create ? 'Create folder' : 'Rename folder'}</DialogTitle>
          <DialogDescription>
            {create
              ? `Add a mail folder to ${state.account.name}.`
              : `Change the name of ${state.folder.name}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-2 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSubmit(name, parentPath);
          }}
        >
          <Field label="Folder name">
            <input
              autoFocus
              className="field"
              value={name}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {create && (
            <Field label="Location">
              <select
                className="field"
                value={parentPath}
                disabled={busy}
                onChange={(event) => setParentPath(event.target.value)}
              >
                <option value="">Top level</option>
                {orderedFolderTree(folders).map((folder) => (
                  <option key={folder.path} value={folder.path}>{folder.path}</option>
                ))}
              </select>
            </Field>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {create ? 'Create' : 'Rename'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFolderDialog({
  folder,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** The folder to confirm deleting; null keeps the dialog closed. */
  folder: MailFolderSummary | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={folder !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{folder?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The folder and any messages it contains will be deleted from the mail server. This
            cannot be undone in Emzero.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-danger">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            Delete folder
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
