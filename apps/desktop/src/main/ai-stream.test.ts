import { describe, expect, it } from 'vitest';
import { parseChatCompletionStreamChunk, takeSseDataEvents } from './ai-stream.js';

describe('AI response streaming', () => {
  it('buffers incomplete SSE events and ignores keep-alive comments', () => {
    const first = takeSseDataEvents(': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"Hel');
    expect(first.events).toEqual([]);
    const second = takeSseDataEvents(`${first.remainder}lo"}}]}\n\ndata: [DONE]\n\n`);
    expect(second.events).toEqual([
      '{"choices":[{"delta":{"content":"Hello"}}]}',
      '[DONE]',
    ]);
  });

  it('reads text, completion, and mid-stream provider errors', () => {
    expect(parseChatCompletionStreamChunk(
      '{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    )).toEqual({ done: false, text: 'Hello' });
    expect(parseChatCompletionStreamChunk('[DONE]')).toEqual({ done: true, text: '' });
    expect(parseChatCompletionStreamChunk(
      '{"error":{"message":"Provider disconnected"},"choices":[]}',
    )).toEqual({ done: true, text: '', error: 'Provider disconnected' });
  });
});
