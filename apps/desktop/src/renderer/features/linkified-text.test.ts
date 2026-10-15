import { describe, expect, it } from 'vitest';
import { linkifyText } from './linkified-text';

describe('linkifyText', () => {
  it('leaves text without URLs untouched', () => {
    expect(linkifyText('Hello there')).toEqual([{ kind: 'text', text: 'Hello there' }]);
  });

  it('links http and https URLs within prose', () => {
    expect(linkifyText('See https://example.com/a?b=1 and http://x.org now')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'http://x.org', url: 'http://x.org' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('links bare www hosts over https', () => {
    expect(linkifyText('www.example.com')).toEqual([
      { kind: 'link', text: 'www.example.com', url: 'https://www.example.com' },
    ]);
  });

  it('excludes trailing punctuation and unbalanced brackets', () => {
    expect(linkifyText('Go to https://example.com/page.')).toContainEqual(
      { kind: 'link', text: 'https://example.com/page', url: 'https://example.com/page' },
    );
    expect(linkifyText('(see https://example.com/x)')).toEqual([
      { kind: 'text', text: '(see ' },
      { kind: 'link', text: 'https://example.com/x', url: 'https://example.com/x' },
      { kind: 'text', text: ')' },
    ]);
    expect(linkifyText('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      { kind: 'link', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', url: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    ]);
  });

  it('stops at angle brackets around URLs', () => {
    expect(linkifyText('<https://example.com>')).toEqual([
      { kind: 'text', text: '<' },
      { kind: 'link', text: 'https://example.com', url: 'https://example.com' },
      { kind: 'text', text: '>' },
    ]);
  });

  it('ignores other schemes', () => {
    expect(linkifyText('javascript:alert(1) file:///etc')).toEqual([
      { kind: 'text', text: 'javascript:alert(1) file:///etc' },
    ]);
  });
});
