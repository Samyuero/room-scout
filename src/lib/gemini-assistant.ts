import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface GeminiAssistantResponse {
  text: string;
  dormIds: string[];
}

export type GeminiDemandLevel = 'high' | 'moderate' | 'low';

export interface GeminiDemandPrediction {
  dormId: string;
  level: GeminiDemandLevel;
  reason: string;
}

export class AssistantRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 0) {
    super(message);
    this.name = 'AssistantRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function throwAssistantError(error: unknown): Promise<never> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      if (payload?.code === 'rate_limited') {
        throw new AssistantRateLimitError(
          typeof payload.error === 'string' ? payload.error : 'The assistant request limit has been reached.',
          Number(payload.retryAfterSeconds) || 0,
        );
      }
    } catch (caught) {
      if (caught instanceof AssistantRateLimitError) throw caught;
    }
  }
  if (error instanceof Error) throw error;
  throw new Error('The dorm assistant could not be reached.');
}

export async function askGeminiAssistant(input: {
  action: 'chat' | 'compare';
  message?: string;
  dormIds?: string[];
}): Promise<GeminiAssistantResponse> {
  const { data, error } = await supabase.functions.invoke('dorm-assistant', {
    body: {
      action: input.action,
      message: input.message?.trim().slice(0, 1000),
      dormIds: input.dormIds?.slice(0, 2),
    },
  });

  if (error) await throwAssistantError(error);
  if (!data || typeof data.text !== 'string') throw new Error('The dorm assistant returned an invalid response.');
  return {
    text: data.text.trim(),
    dormIds: Array.isArray(data.dormIds) ? data.dormIds.filter((id: unknown) => typeof id === 'string') : [],
  };
}

const demandCache = new Map<string, { expires: number; value: Promise<GeminiDemandPrediction[]> }>();

export async function predictDormDemand(dormIds: string[], factsKey = ''): Promise<GeminiDemandPrediction[]> {
  const key = dormIds.slice().sort().join('|') + factsKey;
  const cached = demandCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (demandCache.size > 20) demandCache.clear();
  const value = fetchDormDemand(dormIds);
  demandCache.set(key, { expires: Date.now() + 10 * 60 * 1000, value });
  try { return await value; } catch (error) { demandCache.delete(key); throw error; }
}

async function fetchDormDemand(dormIds: string[]): Promise<GeminiDemandPrediction[]> {
  const { data, error } = await supabase.functions.invoke('dorm-assistant', {
    body: { action: 'predict', dormIds: dormIds.slice(0, 40) },
  });
  if (error) await throwAssistantError(error);
  if (!Array.isArray(data?.predictions)) throw new Error('The demand service returned an invalid response.');
  const allowed = new Set(dormIds);
  return data.predictions
    .filter((item: any) => allowed.has(item?.dormId) && ['high', 'moderate', 'low'].includes(item?.level))
    .map((item: any) => ({
      dormId: String(item.dormId),
      level: item.level as GeminiDemandLevel,
      reason: String(item.reason || '').slice(0, 180),
    }));
}
