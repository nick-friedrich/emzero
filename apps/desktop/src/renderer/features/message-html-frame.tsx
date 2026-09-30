import { useEffect, useRef, useState } from 'react';

// Only this trusted relay may run inside the opaque-origin email sandbox.
export const htmlFrameScript = "document.addEventListener('click',function(event){var link=event.target.closest('a[href]');if(!link)return;event.preventDefault();parent.postMessage({type:'emzero:open-link',url:link.href},'*')});var scheduled=false;function reportHeight(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;parent.postMessage({type:'emzero:resize',height:Math.ceil(document.body.getBoundingClientRect().height)},'*')})}new ResizeObserver(reportHeight).observe(document.body);window.addEventListener('resize',reportHeight);document.addEventListener('load',reportHeight,true);document.fonts.ready.then(reportHeight);reportHeight();";

export const htmlFrameScriptHash = 'sha256-WmDxPvYgCiEAh60fwkSefm7HTpgZkEdo4jF3PZ1ODZ0=';

export function MessageHtmlFrame({ document, onOpenLink }: {
  document: string;
  onOpenLink: (url: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as { type?: unknown; height?: unknown; url?: unknown };
      if (data.type === 'emzero:resize' && typeof data.height === 'number' &&
        Number.isFinite(data.height) && data.height > 0) {
        setHeight(Math.min(1_000_000, Math.ceil(data.height)));
      }
      if (data.type === 'emzero:open-link' && typeof data.url === 'string') {
        try {
          const url = new URL(data.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') onOpenLink(url.toString());
        } catch {
          // Ignore malformed or relative links from email content.
        }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onOpenLink]);

  return <iframe ref={frame} title="Email content" sandbox="allow-scripts"
    referrerPolicy="no-referrer" scrolling="no"
    className="mt-4 block w-full border-0 bg-white"
    style={{ height }} srcDoc={document} />;
}
