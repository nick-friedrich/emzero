import { useLayoutEffect, useRef, type ClipboardEvent } from 'react';
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react';

export function htmlFromText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\n', '<br>');
}

function imageSizes(html: string): number[] {
  return [...html.matchAll(/data:image\/(?:png|jpeg|gif|webp);base64,([a-z\d+/]+={0,2})/gi)]
    .map((match) => Math.floor(match[1].length * 3 / 4));
}

function imageBytes(html: string): number {
  return imageSizes(html).reduce((total, size) => total + size, 0);
}

function safeClipboardHtml(html: string): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'IMG']);
  const destination = document.createElement('div');
  const append = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof Element)) return;
    const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
    if (target !== parent) {
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) (target as HTMLAnchorElement).href = href;
      }
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? '';
        if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(src)) return;
        (target as HTMLImageElement).src = src;
        (target as HTMLImageElement).alt = node.getAttribute('alt') ?? '';
      }
      parent.appendChild(target);
    }
    for (const child of node.childNodes) append(child, target);
  };
  for (const child of source.body.childNodes) append(child, destination);
  return destination.innerHTML;
}

export function RichTextEditor({
  html,
  disabled,
  autoFocus,
  onChange,
  onError,
}: {
  html: string;
  disabled: boolean;
  autoFocus: boolean;
  onChange: (html: string, text: string) => void;
  onError: (message: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html;
  }, [html]);

  const reportChange = () => {
    const node = editor.current;
    if (node) onChange(node.innerHTML, node.innerText);
  };

  const format = (command: string) => {
    editor.current?.focus();
    document.execCommand(command);
    reportChange();
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    event.preventDefault();
    if (images.length === 0) {
      const pastedHtml = event.clipboardData.getData('text/html');
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

  const tools = [
    { label: 'Bold', command: 'bold', Icon: Bold },
    { label: 'Italic', command: 'italic', Icon: Italic },
    { label: 'Underline', command: 'underline', Icon: Underline },
    { label: 'Bulleted list', command: 'insertUnorderedList', Icon: List },
    { label: 'Numbered list', command: 'insertOrderedList', Icon: ListOrdered },
  ];

  return <div className="overflow-hidden rounded-md border border-input bg-background">
    <div className="flex gap-1 border-b border-border p-1" role="toolbar" aria-label="Message formatting">
      {tools.map(({ label, command, Icon }) => <button
        key={command}
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => format(command)}
      ><Icon className="size-4" /></button>)}
    </div>
    <div
      ref={editor}
      role="textbox"
      aria-label="Message"
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={!disabled}
      suppressContentEditableWarning
      autoFocus={autoFocus}
      className="min-h-52 overflow-auto px-3 py-2 text-sm leading-6 outline-none [&_img]:max-w-full [&_img]:h-auto"
      onInput={reportChange}
      onPaste={paste}
    />
  </div>;
}
