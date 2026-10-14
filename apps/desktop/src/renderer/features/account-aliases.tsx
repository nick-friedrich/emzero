import { useState } from 'react';
import { AtSign, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AccountSummary } from '../../shared/accounts';
import { MAX_ACCOUNT_ALIASES, type MailAlias } from '../../shared/aliases';

function sameAliases(left: MailAlias[], right: MailAlias[]) {
  return left.length === right.length && left.every((alias, index) =>
    alias.address.trim() === right[index].address && alias.name.trim() === right[index].name);
}

/** Settings editor for the extra addresses an account can send as. */
export function AccountAliasesEditor({
  account,
  disabled,
  onSave,
}: {
  account: AccountSummary;
  disabled: boolean;
  onSave: (aliases: MailAlias[]) => Promise<void>;
}) {
  const [aliases, setAliases] = useState<MailAlias[]>(account.aliases);
  const [syncedAliases, setSyncedAliases] = useState(account.aliases);
  if (syncedAliases !== account.aliases) {
    setSyncedAliases(account.aliases);
    setAliases(account.aliases);
  }
  const dirty = !sameAliases(aliases, account.aliases);
  const patch = (index: number, values: Partial<MailAlias>) =>
    setAliases((current) => current.map((alias, position) => position === index ? { ...alias, ...values } : alias));

  return <form className="mt-4 border-t border-border pt-4" onSubmit={(event) => {
    event.preventDefault();
    void onSave(aliases.filter((alias) => alias.address.trim()));
  }}>
    <div className="flex items-center gap-2"><AtSign className="size-4 text-muted-foreground" /><h4 className="text-xs font-medium">Aliases</h4></div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Other addresses that deliver into this mailbox, such as a custom email domain. You can send from them, and replies use the alias a message was sent to. Your provider must allow sending as each address.</p>
    {aliases.length > 0 && <div className="mt-3 space-y-2">{aliases.map((alias, index) => <div key={index} className="flex gap-2">
      <input className="field min-w-0 flex-[3]" type="email" required aria-label={`Alias address ${index + 1} for ${account.email}`} placeholder="you@yourdomain.com" autoComplete="off" value={alias.address} disabled={disabled} onChange={(event) => patch(index, { address: event.target.value })} />
      <input className="field min-w-0 flex-[2]" aria-label={`Sender name for alias ${index + 1}`} placeholder={account.name} autoComplete="off" value={alias.name} disabled={disabled} onChange={(event) => patch(index, { name: event.target.value })} />
      <Button type="button" variant="ghost" className="px-3" aria-label={`Remove alias ${alias.address || index + 1}`} disabled={disabled} onClick={() => setAliases((current) => current.filter((_, position) => position !== index))}><X className="size-4" /></Button>
    </div>)}</div>}
    <div className="mt-3 flex gap-2">
      <Button type="button" variant="ghost" disabled={disabled || aliases.length >= MAX_ACCOUNT_ALIASES} onClick={() => setAliases((current) => [...current, { address: '', name: '' }])}><Plus className="size-4" />Add alias</Button>
      {dirty && <Button type="submit" variant="secondary" disabled={disabled}>Save aliases</Button>}
    </div>
  </form>;
}
