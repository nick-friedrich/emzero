import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bold,
  Check,
  Italic,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  TextQuote,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizedLink, safeClipboardHtml } from './clipboard-html';
import { signatureAwareText } from './signature-html';

function imageSizes(html: string): number[] {
  return [...html.matchAll(/data:image\/(?:png|jpeg|gif|webp);base64,([a-z\d+/]+={0,2})/gi)]
    .map((match) => Math.floor(match[1].length * 3 / 4));
}

function imageBytes(html: string): number {
  return imageSizes(html).reduce((total, size) => total + size, 0);
}

function htmlIsEmpty(html: string): boolean {
  return !/<img\b/i.test(html) && !html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\u00a0/g, '').trim();
}

const modifierLabel = () => (window.emzero?.platform === 'darwin' ? '⌘' : 'Ctrl+');

export interface RichTextEditorHandle {
  /** Focus the message, placing the caret at the start (above signatures) or the end. */
  focus: (position?: 'start' | 'end') => void;
}

type FormatState = Record<'bold' | 'italic' | 'underline' | 'strike' | 'bullets' | 'numbers' | 'quote' | 'link', boolean>;
const noFormats: FormatState = {
  bold: false, italic: false, underline: false, strike: false,
  bullets: false, numbers: false, quote: false, link: false,
};

export function RichTextEditor({
  ref,
  html,
  disabled,
  placeholder = 'Write your message…',
  className,
  toolbarContainer,
  onChange,
  onError,
  onPasteFiles,
}: {
  ref?: Ref<RichTextEditorHandle>;
  html: string;
  disabled: boolean;
  placeholder?: string;
  className?: string;
  /** Where to render the formatting toolbar; it is omitted until the container exists. */
  toolbarContainer?: HTMLElement | null;
  onChange: (html: string, text: string) => void;
  onError: (message: string) => void;
  /** Non-image files pasted from the clipboard, offered as attachments. */
  onPasteFiles?: (files: File[]) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const plainPaste = useRef(false);
  const savedRange = useRef<Range | null>(null);
  const [formats, setFormats] = useState<FormatState>(noFormats);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);

  useLayoutEffect(() => {
    if (editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html;
  }, [html]);

  useImperativeHandle(ref, () => ({
    focus: (position = 'start') => {
      const node = editor.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(position === 'start');
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
  }), []);

  useEffect(() => {
    const refresh = () => {
      const node = editor.current;
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (!node || !anchor || !node.contains(anchor)) {
        setFormats(noFormats);
        return;
      }
      const element = anchor instanceof Element ? anchor : anchor.parentElement;
      const inside = (selector: string) => {
        const match = element?.closest(selector);
        return Boolean(match && node.contains(match));
      };
      setFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        bullets: document.queryCommandState('insertUnorderedList'),
        numbers: document.queryCommandState('insertOrderedList'),
        quote: inside('blockquote'),
        link: inside('a'),
      });
    };
    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
  }, []);

  const reportChange = () => {
    const node = editor.current;
    if (node) onChange(node.innerHTML, signatureAwareText(node));
  };

  const restoreSelection = () => {
    const node = editor.current;
    node?.focus({ preventScroll: true });
    const range = savedRange.current;
    if (!node || !range || !node.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const run = (command: string, value?: string) => {
    editor.current?.focus({ preventScroll: true });
    document.execCommand(command, false, value);
    reportChange();
    document.dispatchEvent(new Event('selectionchange'));
  };

  const openLinkEditor = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
    const anchor = selection?.anchorNode;
    const existing = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('a');
    setLinkDraft(existing && editor.current?.contains(existing) ? existing.getAttribute('href') ?? '' : '');
    setLinkError(false);
  };

  const applyLink = () => {
    if (linkDraft === null) return;
    restoreSelection();
    if (!linkDraft.trim()) {
      run('unlink');
      setLinkDraft(null);
      return;
    }
    const href = normalizedLink(linkDraft);
    if (!href) {
      setLinkError(true);
      return;
    }
    const selection = window.getSelection();
    if (selection?.isCollapsed) {
      const label = href.replace(/^mailto:/i, '').replace(/^https?:\/\//i, '');
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      run('insertHTML', `${link.outerHTML}&nbsp;`);
    } else {
      run('createLink', href);
    }
    setLinkDraft(null);
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    const images = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
    const asPlainText = plainPaste.current;
    plainPaste.current = false;
    event.preventDefault();
    if (otherFiles.length > 0) onPasteFiles?.(otherFiles);
    if (images.length === 0) {
      if (otherFiles.length > 0) return;
      const pastedHtml = asPlainText ? '' : event.clipboardData.getData('text/html');
      const safeHtml = pastedHtml ? safeClipboardHtml(pastedHtml) : '';
      if (safeHtml && imageSizes(safeHtml).every((size) => size <= 5 * 1024 * 1024) &&
        imageBytes(safeHtml) + imageBytes(editor.current?.innerHTML ?? '') <= 20 * 1024 * 1024) {
        document.execCommand('insertHTML', false, safeHtml);
      } else {
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
      }
      reportChange();
      return;
    }
    const supported = images.filter((file) => /^(image\/png|image\/jpeg|image\/gif|image\/webp)$/.test(file.type));
    if (supported.length !== images.length) {
      onError('Paste a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    if (supported.some((file) => file.size > 5 * 1024 * 1024) ||
      supported.reduce((total, file) => total + file.size, imageBytes(editor.current?.innerHTML ?? '')) > 20 * 1024 * 1024) {
      onError('Pasted images must be at most 5 MB each and 20 MB in total.');
      return;
    }
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null;
    void (async () => {
      for (const file of supported) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read pasted image.'));
          reader.readAsDataURL(file);
        });
        if (!editor.current?.isConnected) return;
        const image = document.createElement('img');
        image.src = url;
        image.alt = 'Pasted image';
        if (range && editor.current.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(image);
          range.setStartAfter(image);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          editor.current.append(image);
        }
        editor.current.focus();
      }
      reportChange();
    })().catch(() => onError('Could not paste image.'));
  };

  /** Markdown-style shortcuts at the start of a line: "- ", "* ", "1. ", and "> ". */
  const applyLineShortcut = (): boolean => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || node.previousSibling) return false;
    const block = node.parentElement;
    if (!block || !editor.current || (block !== editor.current && !/^(DIV|P)$/.test(block.tagName))) return false;
    const prefix = (node.textContent ?? '').slice(0, selection.anchorOffset);
    const command = /^[-*]$/.test(prefix) ? 'insertUnorderedList'
      : /^1[.)]$/.test(prefix) ? 'insertOrderedList'
        : prefix === '>' ? 'quote' : null;
    if (!command) return false;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, selection.anchorOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
    if (command === 'quote') run('formatBlock', 'blockquote');
    else run(command);
    return true;
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'v') plainPaste.current = true;
    if (modifier && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLinkEditor();
    } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      run('strikeThrough');
    } else if (event.key === ' ' && !modifier && applyLineShortcut()) {
      event.preventDefault();
    } else if (event.key === 'Tab' && (formats.bullets || formats.numbers)) {
      event.preventDefault();
      run(event.shiftKey ? 'outdent' : 'indent');
    }
  };

  type Tool = 'bold' | 'italic' | 'underline' | 'strike' | 'bullets' | 'numbers' | 'quote' | 'link' | 'clear';
  const applyTool = (tool: Tool) => {
    if (tool === 'link') openLinkEditor();
    else if (tool === 'quote') run(formats.quote ? 'outdent' : 'formatBlock', formats.quote ? undefined : 'blockquote');
    else run({
      bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough',
      bullets: 'insertUnorderedList', numbers: 'insertOrderedList', clear: 'removeFormat',
    }[tool]);
  };

  const mod = modifierLabel();
  const groups: { tool: Tool; label: string; Icon: LucideIcon }[][] = [
    [
      { tool: 'bold', label: `Bold (${mod}B)`, Icon: Bold },
      { tool: 'italic', label: `Italic (${mod}I)`, Icon: Italic },
      { tool: 'underline', label: `Underline (${mod}U)`, Icon: Underline },
      { tool: 'strike', label: `Strikethrough (${mod}⇧X)`, Icon: Strikethrough },
    ],
    [
      { tool: 'bullets', label: 'Bulleted list (type “- ”)', Icon: List },
      { tool: 'numbers', label: 'Numbered list (type “1. ”)', Icon: ListOrdered },
      { tool: 'quote', label: 'Quote (type “> ”)', Icon: TextQuote },
      { tool: 'link', label: `Link (${mod}K)`, Icon: Link2 },
    ],
    [{ tool: 'clear', label: 'Clear formatting', Icon: RemoveFormatting }],
  ];

  const toolbar = <div className="relative flex min-w-0 items-center" role="toolbar" aria-label="Message formatting">
    {groups.map((group, index) => <div key={index} className={cn('flex items-center gap-0.5', index > 0 && 'ml-1 border-l border-border/70 pl-1')}>
      {group.map(({ tool, label, Icon }) => <button
        key={tool}
        type="button"
        aria-label={label.replace(/ \(.*\)$/, '')}
        title={label}
        aria-pressed={tool === 'clear' ? undefined : formats[tool]}
        disabled={disabled}
        className={cn(
          'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50',
          tool !== 'clear' && formats[tool] && 'bg-accent text-primary',
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyTool(tool)}
      ><Icon className="size-[0.95rem]" /></button>)}
    </div>)}
    {linkDraft !== null && <div
      className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 flex w-80 max-w-[calc(100vw-3rem)] items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg"
      role="dialog"
      aria-label="Edit link"
    >
      <Link2 className="ml-1.5 size-4 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        className={cn('h-8 min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground/70',
          linkError && 'text-danger')}
        value={linkDraft}
        placeholder="Paste or type a link"
        aria-label="Link address"
        aria-invalid={linkError}
        onChange={(event) => { setLinkDraft(event.target.value); setLinkError(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); applyLink(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinkDraft(null); restoreSelection(); }
        }}
      />
      <button type="button" className="grid size-7 place-items-center rounded-md text-primary hover:bg-accent"
        aria-label="Apply link" onClick={applyLink}><Check className="size-4" /></button>
      <button type="button" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Cancel link" onClick={() => { setLinkDraft(null); restoreSelection(); }}><X className="size-4" /></button>
    </div>}
  </div>;

  return <>
    <div
      ref={editor}
      role="textbox"
      aria-label="Message"
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-empty={htmlIsEmpty(html)}
      className={cn('composer-editor relative min-h-28 break-words text-sm leading-6 outline-none', className)}
      onInput={reportChange}
      onPaste={paste}
      onKeyDown={keyDown}
    />
    {toolbarContainer && createPortal(toolbar, toolbarContainer)}
  </>;
}
