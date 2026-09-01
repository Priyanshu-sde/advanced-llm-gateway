import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import type { ChatMessage } from './providers/types.js';

const TOKENS_PER_MESSAGE = 4;
const REPLY_PRIMING_TOKENS = 3;


const SAFETY_MARGIN = 1.15;

export function estimateInputTokens(messages: ChatMessage[]): number {
  let total = REPLY_PRIMING_TOKENS;
  for (const m of messages) {
    total += TOKENS_PER_MESSAGE;
    total += encode(m.role).length;
    total += encode(m.content ?? '').length;
  }
  return Math.ceil(total * SAFETY_MARGIN);
}

export function estimateOutputTokens(text: string): number {
  return encode(text ?? '').length;
}
