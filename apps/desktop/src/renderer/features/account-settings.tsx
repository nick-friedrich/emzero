import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, Download, Eye, EyeOff, KeyRound, LoaderCircle, Palette, Plus, Search, Trash2, Type, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { AccountSummary } from '../../shared/accounts';
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL, DEFAULT_OPENAI_MODEL, OPENAI_BASE_URL, type AiModelSummary, type AiProvider, type AiSettingsSummary } from '../../shared/ai';
import { interfaceFonts, themes, useTheme, type InterfaceFont, type Theme } from '@/theme';
import type { Status } from './app-shared';
import { saveSignatures, storedSignatures, type MailSignature } from './signatures';

type SettingsTab = 'general' | 'accounts' | 'ai' | 'signatures' | 'backup';
const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'accounts', label: 'Accounts' },
  { id: 'ai', label: 'AI assistant' },
  { id: 'signatures', label: 'Signatures' }, { id: 'backup', label: 'Backup' },
];

function notifyAccountsChanged() {
  const channel = new BroadcastChannel('emzero-settings-events');
  channel.postMessage({ type: 'accounts-changed' });
  channel.close();
}

export function SettingsWindow() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [tab, setTab] = useState<SettingsTab>('general');
  useEffect(() => { void window.emzero.accounts.list().then(setAccounts).catch(() => setAccounts([])); }, []);
  if (accounts === null) return <main className="grid h-screen place-items-center bg-background text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /></main>;
  return <main className="relative flex h-screen min-h-0 bg-background text-foreground">
    {window.emzero.platform === 'darwin' && <div className="macos-titlebar-drag absolute inset-x-0 top-0 z-10 h-8" />}
    <aside className={cn('w-52 shrink-0 border-r border-border bg-sidebar px-3 pb-4 pt-5', window.emzero.platform === 'darwin' && 'pt-12')}>
      <h1 className="px-3 pb-5 text-lg font-semibold">Settings</h1>
      <nav className="space-y-1" aria-label="Settings sections">{tabs.map((item) => <button key={item.id} type="button" className={cn('w-full rounded-md px-3 py-2 text-left text-sm', tab === item.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    </aside>
    <div className="min-w-0 flex-1 overflow-y-auto p-8"><div className="mx-auto max-w-2xl">
      {tab === 'general' && <GeneralSettings />}
      {tab === 'accounts' && <AccountsSettings accounts={accounts} onChange={setAccounts} />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'signatures' && <SignatureSettings accounts={accounts} />}
      {tab === 'backup' && <BackupSettings onImported={setAccounts} />}
    </div></div>
  </main>;
}

function notifyAiSettingsChanged() {
  const channel = new BroadcastChannel('emzero-settings-events');
  channel.postMessage({ type: 'ai-settings-changed' });
  channel.close();
}

function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsSummary | null>(null);
  const [provider, setProvider] = useState<AiProvider>('openrouter');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_AI_BASE_URL);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [modelSearch, setModelSearch] = useState('');
  const [models, setModels] = useState<AiModelSummary[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void window.emzero.ai.getSettings().then((current) => {
      setSettings(current);
      setProvider(current.provider);
      setBaseUrl(current.baseUrl);
      setModel(current.model);
    }).catch(() => setStatus({ kind: 'error', message: 'Could not load AI provider settings.' }));
  }, []);

  const canReuseStoredKey = Boolean(
    settings?.configured && settings.provider === provider && settings.baseUrl === baseUrl,
  );
  const canSearchModels = provider !== 'custom' && Boolean(apiKey.trim() || canReuseStoredKey);

  useEffect(() => {
    if (!modelPickerOpen || provider === 'custom' || !canSearchModels) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setModelsLoading(true);
      setModelError(null);
      void window.emzero.ai.listModels({ provider, baseUrl, apiKey, query: modelSearch })
        .then((result) => {
          if (!active) return;
          setModels(result.models);
          setModelError(result.ok ? null : (result.message ?? 'Could not load models.'));
        })
        .catch(() => {
          if (active) setModelError('Could not load models.');
        })
        .finally(() => {
          if (active) setModelsLoading(false);
        });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [apiKey, baseUrl, canSearchModels, modelPickerOpen, modelSearch, provider]);

  const chooseProvider = (nextProvider: AiProvider) => {
    setProvider(nextProvider);
    setApiKey('');
    setModelSearch('');
    setModels([]);
    setModelPickerOpen(false);
    setModelError(null);
    setStatus(null);
    if (nextProvider === 'openrouter') {
      setBaseUrl(DEFAULT_AI_BASE_URL);
      setModel(DEFAULT_AI_MODEL);
    } else if (nextProvider === 'openai') {
      setBaseUrl(OPENAI_BASE_URL);
      setModel(DEFAULT_OPENAI_MODEL);
    } else {
      setBaseUrl(settings?.provider === 'custom' ? settings.baseUrl : '');
      setModel(settings?.provider === 'custom' ? settings.model : '');
    }
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.emzero.ai.saveSettings({ apiKey, provider, baseUrl, model });
      setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
      if (result.ok && result.settings) {
        setSettings(result.settings);
        setProvider(result.settings.provider);
        setBaseUrl(result.settings.baseUrl);
        setModel(result.settings.model);
        setApiKey('');
        notifyAiSettingsChanged();
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not save AI provider settings.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.emzero.ai.removeSettings();
      setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
      if (result.ok && result.settings) {
        setSettings(result.settings);
        setProvider(result.settings.provider);
        setBaseUrl(result.settings.baseUrl);
        setModel(result.settings.model);
        setApiKey('');
        notifyAiSettingsChanged();
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not remove AI provider settings.' });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Heading title="AI assistant" description="Connect OpenRouter or another OpenAI-compatible provider to draft email replies." />
    <form className="space-y-5 rounded-lg border border-border bg-card p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">Provider connection</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Your API key is encrypted with this device&apos;s secure credential storage. Email text is sent to the configured provider only when you ask it to draft a reply.</p>
        </div>
      </div>
      <label className="block space-y-1.5 text-xs font-medium">
        <span>Provider</span>
        <select className="preference-select preference-select-no-icon" value={provider} disabled={busy} onChange={(event) => chooseProvider(event.target.value as AiProvider)}>
          <option value="openrouter">OpenRouter</option>
          <option value="openai">OpenAI</option>
          <option value="custom">Custom OpenAI-compatible</option>
        </select>
      </label>
      {provider === 'custom' ? <label className="block space-y-1.5 text-xs font-medium">
        <span>API base URL</span>
        <input className="field" type="url" required value={baseUrl} placeholder="https://provider.example/v1" disabled={busy} onChange={(event) => { setBaseUrl(event.target.value); setStatus(null); }} />
        <span className="block font-normal text-muted-foreground">Emzero appends <code>/chat/completions</code> unless the URL already includes it.</span>
      </label> : <p className="rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">API endpoint: <code>{baseUrl}</code></p>}
      <label className="block space-y-1.5 text-xs font-medium">
        <span>API key</span>
        <span className="relative block">
          <KeyRound className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input className="field field-with-leading-icon field-with-trailing-control" type={showApiKey ? 'text' : 'password'} required={!canReuseStoredKey} autoComplete="off" value={apiKey} placeholder={canReuseStoredKey ? 'Stored securely — leave blank to keep it' : provider === 'openrouter' ? 'sk-or-v1-…' : 'API key'} disabled={busy} onChange={(event) => { setApiKey(event.target.value); setStatus(null); }} />
          <button type="button" className="absolute right-2 top-1.5 grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        </span>
      </label>
      {provider === 'custom' ? <label className="block space-y-1.5 text-xs font-medium">
        <span>Model</span>
        <input className="field" required value={model} placeholder="provider/model-name" disabled={busy} onChange={(event) => { setModel(event.target.value); setStatus(null); }} />
      </label> : <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">Model</span><span className="truncate text-muted-foreground" title={model}>Selected: {model}</span></div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input className="field field-with-leading-icon field-with-trailing-control" value={modelSearch} placeholder={canSearchModels ? 'Search models by name or slug…' : 'Enter an API key to search models'} disabled={busy || !canSearchModels} onFocus={() => setModelPickerOpen(true)} onChange={(event) => { setModelSearch(event.target.value); setModelPickerOpen(true); }} />
          {modelsLoading && <LoaderCircle className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />}
        </div>
        {modelPickerOpen && canSearchModels && <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-sm">
          {modelError ? <p className="px-3 py-2 text-xs text-danger">{modelError}</p> : !modelsLoading && models.length === 0 ? <p className="px-3 py-2 text-xs text-muted-foreground">No matching models.</p> : models.map((item) => <button key={item.id} type="button" className={cn('block w-full rounded px-3 py-2 text-left hover:bg-accent', item.id === model && 'bg-accent/60')} onClick={() => { setModel(item.id); setModelSearch(''); setModelPickerOpen(false); setStatus(null); }}><span className="block text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.id}</span></button>)}
        </div>}
      </div>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !baseUrl.trim() || !model.trim() || (!canReuseStoredKey && !apiKey.trim())}>{busy && <LoaderCircle className="size-4 animate-spin" />}{settings?.configured ? 'Save changes' : 'Connect provider'}</Button>
        {settings?.configured && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" className="text-danger hover:text-danger" disabled={busy}>Remove</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove the AI provider?</AlertDialogTitle><AlertDialogDescription>This deletes the stored API key and disables AI drafting. Your email and drafts are not affected.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>Remove provider</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
      </div>
    </form>
    <StatusMessage status={status} />
  </>;
}

function Heading({ title, description }: { title: string; description: string }) {
  return <header className="mb-6"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></header>;
}

function Toggle({ checked, onChange, title, description }: { checked: boolean; onChange: (value: boolean) => void; title: string; description: string }) {
  return <label className="flex cursor-pointer items-start gap-3 py-3"><input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span></label>;
}

function GeneralSettings() {
  const preferences = useTheme();
  return <><Heading title="General" description="Choose how Emzero looks and behaves on this device." />
    <section className="space-y-4 rounded-lg border border-border bg-card p-5"><div className="flex items-center gap-3"><Palette className="size-5 text-muted-foreground" /><h3 className="text-sm font-medium">Appearance</h3></div><div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1.5 text-xs font-medium"><span>Color theme</span><span className="relative block"><Palette className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><select className="preference-select" value={preferences.theme} onChange={(event) => preferences.setTheme(event.target.value as Theme)}>{themes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></span></label>
      <label className="space-y-1.5 text-xs font-medium"><span>Interface font</span><span className="relative block"><Type className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><select className="preference-select" value={preferences.interfaceFont} onChange={(event) => preferences.setInterfaceFont(event.target.value as InterfaceFont)}>{interfaceFonts.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></span></label>
    </div></section>
    <section className="mt-5 rounded-lg border border-border bg-card p-5"><h3 className="mb-1 text-sm font-medium">Mail behavior</h3>
      <Toggle checked={preferences.markReadOnOpen} onChange={preferences.setMarkReadOnOpen} title="Mark as read automatically" description="Automatically mark unread messages as read after you view their conversation." />
      <Toggle checked={preferences.selectNextOnDelete} onChange={preferences.setSelectNextOnDelete} title="Select the next email after deleting" description="Keep reading by opening the next conversation in the list after a delete." />
      <Toggle checked={preferences.desktopNotifications} onChange={preferences.setDesktopNotifications} title="Show desktop notifications" description="Show the sender and subject when new unread mail arrives while Emzero is in the background." />
      <Toggle checked={preferences.alwaysLoadRemoteImages} onChange={preferences.setAlwaysLoadRemoteImages} title="Always load remote images" description="Remote senders may use images to learn when you open a message. Leave this off for better privacy." />
    </section>
  </>;
}

function AccountsSettings({ accounts, onChange }: { accounts: AccountSummary[]; onChange: (accounts: AccountSummary[]) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const rename = async (account: AccountSummary) => {
    const name = (names[account.id] ?? account.name).trim(); if (!name || name === account.name) return;
    setBusy(account.id); setStatus(null);
    try { const result = await window.emzero.accounts.update(account.id, { name }); if (result.ok && result.account) { onChange(accounts.map((item) => item.id === account.id ? result.account! : item)); setStatus({ kind: 'success', message: result.message }); notifyAccountsChanged(); } else setStatus({ kind: 'error', message: result.message }); }
    catch { setStatus({ kind: 'error', message: 'The account could not be updated.' }); } finally { setBusy(null); }
  };
  const remove = async (account: AccountSummary) => {
    setBusy(account.id); setStatus(null);
    try { const result = await window.emzero.accounts.remove(account.id); if (result.ok) { onChange(accounts.filter((item) => item.id !== account.id)); saveSignatures(storedSignatures().map((signature) => ({ ...signature, accountIds: signature.accountIds.filter((id) => id !== account.id) }))); setStatus({ kind: 'success', message: `${account.email} was deleted.` }); notifyAccountsChanged(); } else setStatus({ kind: 'error', message: result.message }); }
    catch { setStatus({ kind: 'error', message: 'The account could not be deleted.' }); } finally { setBusy(null); }
  };
  return <><Heading title="Accounts" description="Rename or remove connected mail accounts." /><div className="space-y-3">{accounts.map((account) => <div key={account.id} className="rounded-lg border border-border bg-card p-4"><div className="mb-3"><p className="text-sm font-medium">{account.name}</p><p className="text-xs text-muted-foreground">{account.email}</p></div><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void rename(account); }}><input className="field min-w-0 flex-1" aria-label={`Name for ${account.email}`} value={names[account.id] ?? account.name} disabled={busy === account.id} onChange={(event) => setNames((current) => ({ ...current, [account.id]: event.target.value }))} /><Button type="submit" variant="secondary" disabled={busy === account.id || !names[account.id]?.trim() || names[account.id]?.trim() === account.name}>Save</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" className="px-3 text-danger hover:text-danger" aria-label={`Delete ${account.email}`}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {account.name}?</AlertDialogTitle><AlertDialogDescription>This removes the account and its locally cached mail. It does not delete mail from the provider.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void remove(account)}>Delete account</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></form></div>)}</div><StatusMessage status={status} /></>;
}

function SignatureSettings({ accounts }: { accounts: AccountSummary[] }) {
  const [signatures, setSignatures] = useState<MailSignature[]>(storedSignatures);
  const [selectedId, setSelectedId] = useState<string | null>(() => storedSignatures()[0]?.id ?? null);
  const selected = signatures.find((item) => item.id === selectedId) ?? null;
  const update = (next: MailSignature[]) => { setSignatures(next); saveSignatures(next); };
  const patch = (values: Partial<MailSignature>) => {
    if (!selectedId) return;
    setSignatures((current) => {
      const next = current.map((item) => item.id === selectedId ? { ...item, ...values } : item);
      saveSignatures(next);
      return next;
    });
  };
  const add = () => { const item: MailSignature = { id: crypto.randomUUID(), name: 'New signature', body: '', accountIds: [] }; update([...signatures, item]); setSelectedId(item.id); };
  return <><Heading title="Signatures" description="Create signatures and assign each one to one or more sending accounts." /><div className="grid min-h-[26rem] grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card"><div className="border-r border-border p-3"><Button type="button" variant="secondary" className="mb-3 w-full" onClick={add}><Plus className="size-4" />New signature</Button>{signatures.map((item) => <button key={item.id} type="button" className={cn('mb-1 w-full truncate rounded-md px-3 py-2 text-left text-sm', selectedId === item.id ? 'bg-accent font-medium' : 'hover:bg-accent/60')} onClick={() => setSelectedId(item.id)}>{item.name || 'Untitled signature'}</button>)}</div><div className="p-5">{selected ? <div className="space-y-5"><label className="block space-y-1.5 text-xs font-medium"><span>Name</span><input className="field" name={`signature-name-${selected.id}`} autoComplete="off" value={selected.name} onChange={(event) => patch({ name: event.target.value })} /></label><label className="block space-y-1.5 text-xs font-medium"><span>Signature</span><textarea className="field min-h-36 resize-y" name={`signature-body-${selected.id}`} autoComplete="off" placeholder="Your name, title, contact details…" value={selected.body} onChange={(event) => patch({ body: event.target.value })} /></label><fieldset><legend className="text-xs font-medium">Use for accounts</legend><div className="mt-2 space-y-2">{accounts.map((account) => <label key={account.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.accountIds.includes(account.id)} onChange={(event) => { const accountIds = event.target.checked ? [...selected.accountIds, account.id] : selected.accountIds.filter((id) => id !== account.id); const next = signatures.map((item) => item.id !== selected.id && event.target.checked ? { ...item, accountIds: item.accountIds.filter((id) => id !== account.id) } : item).map((item) => item.id === selected.id ? { ...item, accountIds } : item); update(next); }} /><span>{account.name} <span className="text-muted-foreground">({account.email})</span></span></label>)}</div></fieldset><Button type="button" variant="ghost" className="text-danger hover:text-danger" onClick={() => { const next = signatures.filter((item) => item.id !== selected.id); update(next); setSelectedId(next[0]?.id ?? null); }}><Trash2 className="size-4" />Delete signature</Button></div> : <div className="grid h-full place-items-center text-sm text-muted-foreground">Create a signature to get started.</div>}</div></div></>;
}

function BackupSettings({ onImported }: { onImported: (accounts: AccountSummary[]) => void }) {
  const preferences = useTheme();
  const [exportPassword, setExportPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [importPassword, setImportPassword] = useState('');
  const [selectedBackup, setSelectedBackup] = useState<{ id: string; fileName: string } | null>(null); const [includeCredentials, setIncludeCredentials] = useState(true); const [includeAppSettings, setIncludeAppSettings] = useState(true); const [busy, setBusy] = useState<'export' | 'import' | null>(null); const [status, setStatus] = useState<Status | null>(null);
  const exportBackup = async () => { if (exportPassword.length < 8) return setStatus({ kind: 'error', message: 'Use a backup password with at least 8 characters.' }); if (exportPassword !== confirmPassword) return setStatus({ kind: 'error', message: 'The backup passwords do not match.' }); setBusy('export'); try { const result = await window.emzero.accounts.exportBackup({ password: exportPassword, includeCredentials, includeAppSettings, ...(includeAppSettings ? { appSettings: { theme: preferences.theme, interfaceFont: preferences.interfaceFont, alwaysLoadRemoteImages: preferences.alwaysLoadRemoteImages, markReadOnOpen: preferences.markReadOnOpen, selectNextOnDelete: preferences.selectNextOnDelete, desktopNotifications: preferences.desktopNotifications, signatures: storedSignatures() } } : {}) }); if (!result.canceled) setStatus({ kind: result.ok ? 'success' : 'error', message: result.message }); } catch { setStatus({ kind: 'error', message: 'The backup could not be exported.' }); } finally { setBusy(null); } };
  const choose = async () => { setBusy('import'); try { const result = await window.emzero.accounts.selectBackup(); if (result.ok && result.selectionId && result.fileName) setSelectedBackup({ id: result.selectionId, fileName: result.fileName }); else if (!result.canceled) setStatus({ kind: 'error', message: result.message }); } catch { setStatus({ kind: 'error', message: 'The backup file could not be selected.' }); } finally { setBusy(null); } };
  const importBackup = async () => { if (!selectedBackup || !importPassword) return setStatus({ kind: 'error', message: 'Choose a backup and enter its password.' }); setBusy('import'); try { const result = await window.emzero.accounts.importBackup({ selectionId: selectedBackup.id, password: importPassword }); if (result.ok && result.accounts) { onImported(result.accounts); notifyAccountsChanged(); } if (result.ok && result.appSettings) { preferences.setTheme(result.appSettings.theme as Theme); preferences.setInterfaceFont(result.appSettings.interfaceFont as InterfaceFont); preferences.setAlwaysLoadRemoteImages(result.appSettings.alwaysLoadRemoteImages); preferences.setMarkReadOnOpen(result.appSettings.markReadOnOpen); preferences.setSelectNextOnDelete(result.appSettings.selectNextOnDelete); preferences.setDesktopNotifications(result.appSettings.desktopNotifications); saveSignatures(result.appSettings.signatures); } if (!result.canceled) setStatus({ kind: result.ok ? 'success' : 'error', message: `${result.message}${result.ok && result.appSettings ? ' App settings and signatures restored.' : ''}` }); } catch { setStatus({ kind: 'error', message: 'The backup could not be imported.' }); } finally { setBusy(null); } };
  return <><Heading title="Backup" description="Export or restore your accounts, settings, and signatures." /><section className="space-y-3 rounded-lg border border-border bg-card p-5"><h3 className="text-sm font-medium">Export backup</h3><div className="grid gap-2 sm:grid-cols-2"><input className="field" type="password" placeholder="Backup password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} /><input className="field" type="password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div><Toggle checked={includeCredentials} onChange={setIncludeCredentials} title="Include credentials" description="Include passwords and sign-in tokens for restoration on another device." /><Toggle checked={includeAppSettings} onChange={setIncludeAppSettings} title="Include app settings and signatures" description="Include appearance, mail behavior preferences, signatures, and their account assignments." /><Button variant="secondary" disabled={busy !== null} onClick={() => void exportBackup()}><Download className="size-4" />Export backup</Button></section><section className="mt-5 space-y-3 rounded-lg border border-border bg-card p-5"><h3 className="text-sm font-medium">Import backup</h3><p className="text-xs text-muted-foreground">Any app settings included in the backup will be restored automatically.</p><Button variant="secondary" disabled={busy !== null} onClick={() => void choose()}><Upload className="size-4" />{selectedBackup ? 'Choose another file' : 'Choose backup file'}</Button>{selectedBackup && <><p className="truncate text-xs text-muted-foreground">Selected: {selectedBackup.fileName}</p><input className="field" type="password" placeholder="Backup password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} /><Button variant="secondary" disabled={busy !== null} onClick={() => void importBackup()}>{busy === 'import' && <LoaderCircle className="size-4 animate-spin" />}Import backup</Button></>}</section><StatusMessage status={status} /></>;
}

function StatusMessage({ status }: { status: Status | null }) {
  return status ? <p className={cn('mt-4 flex items-center gap-2 text-sm', status.kind === 'success' ? 'text-success' : 'text-danger')} role="status">{status.kind === 'success' ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}{status.message}</p> : null;
}
