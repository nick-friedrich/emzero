import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usesImplicitTls, type AccountConnectionUpdate, type AccountSummary } from '../../shared/accounts';
import { ServerFields } from './account-setup';
import { Field } from './form-field';

function initialConnection(account: AccountSummary): AccountConnectionUpdate {
  return { username: account.username, imap: account.imap, smtp: account.smtp, password: '' };
}

/** Settings editor for an account's username, password, and IMAP/SMTP servers. */
export function AccountConnectionEditor({
  account,
  disabled,
  onSave,
}: {
  account: AccountSummary;
  disabled: boolean;
  /** Verifies and saves the details; resolves true when they were saved. */
  onSave: (update: AccountConnectionUpdate) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [connection, setConnection] = useState(() => initialConnection(account));
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = disabled || saving;

  const header = <div className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /><h4 className="text-xs font-medium">Server and sign-in</h4></div>;

  if (account.authentication === 'microsoft-oauth') {
    return <div className="mt-4 border-t border-border pt-4">{header}<p className="mt-1 text-xs leading-5 text-muted-foreground">Signed in with Microsoft as {account.username}. To use a different Microsoft account, delete this account and add it again.</p></div>;
  }

  if (!editing) {
    return <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>{header}<p className="mt-1 text-xs leading-5 text-muted-foreground">Username {account.username} · IMAP {account.imap.host}:{account.imap.port} · SMTP {account.smtp.host}:{account.smtp.port}</p></div>
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => { setConnection(initialConnection(account)); setShowPassword(false); setEditing(true); }}>Edit</Button>
      </div>
    </div>;
  }

  const setServer = (protocol: 'imap' | 'smtp', key: 'host' | 'port' | 'secure', value: string | number | boolean) => {
    setConnection((current) => {
      const server = { ...current[protocol], [key]: value };
      if (key === 'port') server.secure = usesImplicitTls(server);
      return { ...current, [protocol]: server };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (await onSave({ ...connection, password: connection.password || undefined })) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return <form className="mt-4 space-y-5 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <div>{header}<p className="mt-1 text-xs leading-5 text-muted-foreground">Emzero signs in to both servers with these details before saving them.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Username">
        <input className="field" required autoComplete="off" aria-label={`Username for ${account.email}`} value={connection.username} disabled={busy} onChange={(event) => setConnection((current) => ({ ...current, username: event.target.value }))} />
      </Field>
      <Field label="Password">
        <span className="relative block">
          <input className="field field-with-trailing-control" type={showPassword ? 'text' : 'password'} autoComplete="new-password" aria-label={`New password for ${account.email}`} placeholder="Leave blank to keep the current one" value={connection.password} disabled={busy} onChange={(event) => setConnection((current) => ({ ...current, password: event.target.value }))} />
          <button type="button" className="absolute right-2 top-1.5 grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        </span>
      </Field>
    </div>
    <ServerFields title="Incoming mail (IMAP)" protocol="imap" server={connection.imap} disabled={busy} onChange={setServer} />
    <ServerFields title="Outgoing mail (SMTP)" protocol="smtp" server={connection.smtp} disabled={busy} onChange={setServer} />
    <div className="flex gap-2">
      <Button type="submit" disabled={busy || !connection.username.trim() || !connection.imap.host.trim() || !connection.smtp.host.trim()}>{saving && <LoaderCircle className="size-4 animate-spin" />}{saving ? 'Verifying…' : 'Verify and save'}</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  </form>;
}
