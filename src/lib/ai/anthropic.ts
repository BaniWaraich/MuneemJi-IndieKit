import Anthropic from '@anthropic-ai/sdk';

let _anthropic: Anthropic | undefined;
export const getAnthropic = () =>
  (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
