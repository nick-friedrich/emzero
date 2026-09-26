import sanitizeHtml from 'sanitize-html';

const imageSource = /^data:image\/(?:png|jpeg|gif|webp);base64,([a-z\d+/]+={0,2})$/i;
const maximumImageSize = 5 * 1024 * 1024;
const maximumImagesSize = 20 * 1024 * 1024;

/** Keep outgoing markup small and predictable before it reaches MIME compilation. */
export function outgoingHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length > 30 * 1024 * 1024) throw new Error('The formatted message is too large.');
  const cleaned = sanitizeHtml(value, {
    allowedTags: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'img'],
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
  let total = 0;
  sanitizeHtml(cleaned, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src'] },
    allowedSchemesByTag: { img: ['data'] },
    transformTags: {
      img: (_tag, attributes) => {
        const match = imageSource.exec(attributes.src ?? '');
        if (!match) throw new Error('This message contains an unsupported image.');
        const size = Math.floor(match[1].length * 3 / 4);
        if (size > maximumImageSize) throw new Error('Each pasted image must be 5 MB or smaller.');
        total += size;
        if (total > maximumImagesSize) throw new Error('Pasted images cannot exceed 20 MB in total.');
        return { tagName: 'img', attribs: attributes };
      },
    },
  });
  return cleaned || undefined;
}
