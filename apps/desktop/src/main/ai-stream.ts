interface ChatCompletionStreamChunk {
  done: boolean;
  text: string;
  error?: string;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '')
    .join('');
}

export function takeSseDataEvents(value: string): { events: string[]; remainder: string } {
  const normalized = value.replaceAll('\r\n', '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const events = blocks
    .map((block) => block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n'))
    .filter(Boolean);
  return { events, remainder };
}

export function parseChatCompletionStreamChunk(data: string): ChatCompletionStreamChunk {
  if (data.trim() === '[DONE]') return { done: true, text: '' };
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return { done: false, text: '' };
    const error = (value as { error?: unknown }).error;
    if (error) {
      const message = error && typeof error === 'object'
        ? (error as { message?: unknown }).message
        : error;
      return {
        done: true,
        text: '',
        error: typeof message === 'string' ? message : 'The AI provider stopped the response.',
      };
    }
    const choices = (value as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) return { done: false, text: '' };
    const choice = choices[0];
    if (!choice || typeof choice !== 'object') return { done: false, text: '' };
    const delta = (choice as { delta?: unknown }).delta;
    const text = delta && typeof delta === 'object'
      ? contentText((delta as { content?: unknown }).content)
      : '';
    const streamFailed = (choice as { finish_reason?: unknown }).finish_reason === 'error';
    return {
      done: streamFailed,
      text,
      ...(streamFailed ? { error: 'The AI provider stopped the response.' } : {}),
    };
  } catch {
    return { done: false, text: '' };
  }
}
