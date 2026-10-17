import {
  app,
  clipboard,
  Menu,
  nativeImage,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

function copyableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

async function imageFromSource(contents: WebContents, source: string): Promise<Electron.NativeImage | null> {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(source.slice(0, comma))) return null;
    return nativeImage.createFromBuffer(Buffer.from(source.slice(comma + 1), 'base64'));
  }
  if (!/^https?:/i.test(source)) return null;
  const response = await contents.session.fetch(source);
  if (!response.ok) return null;
  return nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
}

// copyImageAt only hit-tests the top-level document, so it cannot reach images
// inside the sandboxed HTML-email frame. Decode the image's own source instead;
// mailparser has already turned inline cid: images into data: URLs.
async function copyImage(contents: WebContents, params: ContextMenuParams): Promise<void> {
  if (params.frame && params.frame !== contents.mainFrame) {
    const image = await imageFromSource(contents, params.srcURL).catch(() => null);
    if (image && !image.isEmpty()) {
      clipboard.writeImage(image);
      return;
    }
  }
  contents.copyImageAt(params.x, params.y);
}

function attachContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const separate = () => {
      if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
    };

    if (params.mediaType === 'image' && params.hasImageContents) {
      items.push({ label: 'Copy Image', click: () => void copyImage(contents, params) });
      if (copyableUrl(params.srcURL)) {
        items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
      }
    }
    if (params.linkURL && copyableUrl(params.linkURL)) {
      separate();
      items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.isEditable) {
      separate();
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      separate();
      items.push({ role: 'copy' });
    }

    if (!items.length) return;
    Menu.buildFromTemplate(items).popup();
  });
}

// Electron shows no context menu by default. Rows that handle right-click
// themselves call preventDefault, which suppresses this native menu.
export function registerContextMenus(): void {
  app.on('web-contents-created', (_event, contents) => attachContextMenu(contents));
}
