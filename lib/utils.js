import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import OpenAI from 'openai';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const initOpenai = () => {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return null;
}
