import {
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Server,
  XCircle,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui/button';
import {
  type AccountDraft,
  type AccountSummary,
  type MailProvider,
  defaultAccountName,
  validateAccountDraft,
} from '../../shared/accounts';
import type { Status } from './app-shared';
import { Field } from './form-field';


const initialDraft: AccountDraft = {
  name: '',
  email: '',
  username: '',
  credentials: { type: 'password', password: '' },
  imap: { host: '', port: 993, secure: true },
  smtp: { host: '', port: 465, secure: true },
};


function ServerFields({
  title,
  protocol,
  server,
  onChange,
}: {
  title: string;
  protocol: 'imap' | 'smtp';
  server: AccountDraft['imap'];
  onChange: (
    protocol: 'imap' | 'smtp',
    key: 'host' | 'port' | 'secure',
    value: string | number | boolean,
  ) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Host">
          <input
            className="field"
            placeholder={`${protocol}.example.com`}
            value={server.host}
            onChange={(event) => onChange(protocol, 'host', event.target.value)}
          />
        </Field>
        <Field label="Port">
          <input
            className="field"
            type="number"
            min="1"
            max="65535"
            value={server.port}
            onChange={(event) => onChange(protocol, 'port', Number(event.target.value))}
          />
        </Field>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          className="size-4 accent-primary"
          type="checkbox"
          checked={server.secure}
          onChange={(event) => onChange(protocol, 'secure', event.target.checked)}
        />
        Use implicit TLS
      </label>
    </fieldset>
  );
}

export function AccountSetup({
  providers,
  canCancel,
  onCancel,
  onSaved,
}: {
  providers: MailProvider[];
  canCancel: boolean;
  onCancel: () => void;
  onSaved: (account: AccountSummary) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [preset, setPreset] = useState('custom');
  const [detection, setDetection] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'microsoft' | null>(null);
  const [microsoftPrompt, setMicrosoftPrompt] = useState<{
    sessionId: string;
    message: string;
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const [microsoftCodeCopied, setMicrosoftCodeCopied] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const choosePreset = (nextPreset: string) => {
    setPreset(nextPreset);
    const provider = providers.find((candidate) => candidate.id === nextPreset);
    if (provider) {
      setDraft((current) => ({
        ...current,
        imap: provider.imap,
        smtp: provider.smtp,
        credentials:
          provider.authentication === 'microsoft-oauth'
            ? { type: 'microsoft-oauth' }
            : {
                type: 'password',
                password:
                  current.credentials.type === 'password'
                    ? current.credentials.password
                    : '',
              },
      }));
    } else {
      setDraft((current) => ({
        ...current,
        credentials: {
          type: 'password',
          password: current.credentials.type === 'password' ? current.credentials.password : '',
        },
      }));
    }
    setMicrosoftPrompt(null);
    setMicrosoftCodeCopied(false);
    setDetection(null);
    setStatus(null);
  };

  useEffect(() => {
    const email = draft.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      window.emzero.providers
        .discover(email)
        .then(({ provider, detectedBy }) => {
          if (!active || !provider) return;
          setPreset(provider.id);
          setDraft((current) =>
            current.email.trim() === email
              ? {
                  ...current,
                  imap: provider.imap,
                  smtp: provider.smtp,
                  credentials:
                    provider.authentication === 'microsoft-oauth'
                      ? { type: 'microsoft-oauth' }
                      : {
                          type: 'password',
                          password:
                            current.credentials.type === 'password'
                              ? current.credentials.password
                              : '',
                        },
                }
              : current,
          );
          setDetection(
            detectedBy === 'mx'
              ? `${provider.name} detected from this domain's mail records.`
              : `${provider.name} detected from the email address.`,
          );
        })
        .catch(() => undefined);
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.email]);

  const setServer = (
    protocol: 'imap' | 'smtp',
    key: 'host' | 'port' | 'secure',
    value: string | number | boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [key]: value },
    }));
    setStatus(null);
  };

  const run = async (action: 'test' | 'save') => {
    setBusy(action);
    setStatus(null);
    try {
      const result = await window.emzero.accounts[action](draft);
      setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
      if (result.ok && result.account) onSaved(result.account);
    } catch {
      setStatus({ kind: 'error', message: 'Emzero could not complete this request.' });
    } finally {
      setBusy(null);
    }
  };

  const connectMicrosoft = async () => {
    const validationError = validateAccountDraft(draft);
    if (validationError || draft.credentials.type !== 'microsoft-oauth') {
      setStatus({ kind: 'error', message: validationError ?? 'Choose Microsoft sign-in.' });
      return;
    }
    setBusy('microsoft');
    setStatus(null);
    setMicrosoftPrompt(null);
    setMicrosoftCodeCopied(false);
    try {
      const start = await window.emzero.accounts.beginMicrosoftAuth();
      if (!start.ok || !start.sessionId || !start.userCode || !start.verificationUri) {
        setStatus({ kind: 'error', message: start.message });
        return;
      }
      setMicrosoftPrompt({
        sessionId: start.sessionId,
        message: start.message,
        userCode: start.userCode,
        verificationUri: start.verificationUri,
      });
      const result = await window.emzero.accounts.finishMicrosoftAuth(start.sessionId, draft);
      setStatus({ kind: result.ok ? 'success' : 'error', message: result.message });
      if (result.ok && result.account) onSaved(result.account);
    } catch {
      setStatus({ kind: 'error', message: 'Emzero could not complete Microsoft sign-in.' });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.credentials.type === 'microsoft-oauth') void connectMicrosoft();
    else void run('save');
  };

  const cancel = () => {
    if (microsoftPrompt) {
      void window.emzero.accounts.cancelMicrosoftAuth(microsoftPrompt.sessionId);
    }
    onCancel();
  };

  return (
    <section className="min-w-0 overflow-y-auto bg-background px-4 pb-8 pt-20 sm:px-8 lg:p-12">
      <form className="mx-auto max-w-3xl" onSubmit={submit}>
        <div className="mb-8">
          <div className="mb-4 grid size-11 place-items-center rounded-xl border border-border bg-card shadow-sm">
            <Server className="size-5 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect an email account</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Emzero connects directly to your mail provider. Credentials are encrypted by
            your operating system and never exposed to the web view.
          </p>
        </div>

        <div className="space-y-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-semibold">Account details</legend>
            <Field label="Email address">
              <input
                className="field"
                type="email"
                placeholder="you@example.com"
                value={draft.email}
                onChange={(event) => {
                  const email = event.target.value;
                  setDetection(null);
                  setDraft((current) => ({
                    ...current,
                    email,
                    name:
                      current.name === defaultAccountName(current.email)
                        ? defaultAccountName(email)
                        : current.name,
                    username: current.username === current.email ? email : current.username,
                  }));
                }}
                autoComplete="email"
              />
            </Field>
            <Field label="Username">
              <input
                className="field"
                placeholder="Usually your email address"
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                autoComplete="username"
              />
            </Field>
            <Field label="Account name">
              <input
                className="field"
                placeholder="Uses the email address by default"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Provider">
              <div className="relative">
                <select
                  className="field appearance-none pr-9"
                  value={preset}
                  onChange={(event) => choosePreset(event.target.value)}
                >
                  <option value="custom">Custom IMAP</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
              </div>
              {detection && (
                <span className="mt-2 flex items-center gap-1.5 text-xs font-normal text-success">
                  <CheckCircle2 className="size-3.5" />
                  {detection}
                </span>
              )}
            </Field>
            {draft.credentials.type === 'password' ? (
              <div className="sm:col-span-2">
                <Field label={preset === 'gmail' ? 'Google app password' : 'Password or app password'}>
                  <input
                    className="field"
                    type="password"
                    value={draft.credentials.password}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        credentials: { type: 'password', password: event.target.value },
                      })
                    }
                    autoComplete="current-password"
                  />
                </Field>
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                  <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
                  {preset === 'gmail'
                    ? 'Use a 16-character Google app password. It requires 2-Step Verification; your normal Google password will not work.'
                    : 'Some providers require an app-specific password.'}
                </p>
                {preset === 'gmail' && (
                  <button
                    className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    type="button"
                    onClick={() => void window.emzero.accounts.openGmailAppPasswordHelp()}
                  >
                    Learn how to create a Google app password
                  </button>
                )}
              </div>
            ) : (
              <div className="sm:col-span-2">
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Emzero will open Microsoft’s secure device sign-in page. Sign in with the
                  Microsoft account you want to connect and approve mail access.
                </p>
              </div>
            )}
          </fieldset>

          {draft.credentials.type === 'password' && (
            <>
              <div className="h-px bg-border" />

              <div className="grid gap-7 md:grid-cols-2">
                <ServerFields
                  title="Incoming mail (IMAP)"
                  protocol="imap"
                  server={draft.imap}
                  onChange={setServer}
                />
                <ServerFields
                  title="Outgoing mail (SMTP)"
                  protocol="smtp"
                  server={draft.smtp}
                  onChange={setServer}
                />
              </div>
            </>
          )}
        </div>

        {microsoftPrompt && (
          <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status">
            <p className="font-medium">Complete Microsoft sign-in in your browser</p>
            <p className="mt-1 text-muted-foreground">
              Copy this code, then open Microsoft and enter it to continue.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="field min-w-0 flex-1 font-mono text-base font-semibold tracking-wider"
                aria-label="Microsoft device code"
                readOnly
                value={microsoftPrompt.userCode}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(microsoftPrompt.userCode)
                    .then(() => setMicrosoftCodeCopied(true))
                    .catch(() => {
                      setStatus({
                        kind: 'error',
                        message: 'Could not copy the code. Select it and copy it manually.',
                      });
                    });
                }}
              >
                <Copy className="size-4" />
                {microsoftCodeCopied ? 'Copied' : 'Copy code'}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void window.emzero.accounts.openMicrosoftAuthPage(
                    microsoftPrompt.verificationUri,
                  )
                }
              >
                <ExternalLink className="size-4" />
                Open Microsoft
              </Button>
            </div>
          </div>
        )}

        {status && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
              status.kind === 'success'
                ? 'border-success/25 bg-success/8 text-success'
                : 'border-danger/25 bg-danger/8 text-danger'
            }`}
            role="status"
          >
            {status.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{status.message}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div>
            {canCancel && (
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            {draft.credentials.type === 'password' && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void run('test')}
              >
                {busy === 'test' && <LoaderCircle className="size-4 animate-spin" />}
                Test connection
              </Button>
            )}
            <Button type="submit" disabled={busy !== null}>
              {(busy === 'save' || busy === 'microsoft') && (
                <LoaderCircle className="size-4 animate-spin" />
              )}
              {draft.credentials.type === 'microsoft-oauth'
                ? 'Connect with Microsoft'
                : 'Connect account'}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
