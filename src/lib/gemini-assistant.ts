import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Dorm, DormFilters, DormPreferences, UserCoordinates } from '@/types/dorm';

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
let demandCooldown = 0;

export class AssistantRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 0) {
    super(message);
    this.name = 'AssistantRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The server reports a reached quota/limit, not a percentage remaining. */
export function getAssistantQuotaWarning(error: unknown): string | null {
  if (!(error instanceof AssistantRateLimitError)) return null;
  return 'SNAP’s free online quota or request limit has been reached. Local results are still available. Please try again later.';
}

function snapText(value: string) {
  return value.replace(/\bGemini\b/gi, 'SNAP');
}

async function throwAssistantError(error: unknown): Promise<never> {
  if (error instanceof FunctionsHttpError) {
    let payload: { code?: string; retryAfterSeconds?: number } | null = null;
    try {
      payload = await error.context.json();
    } catch { /* HTTP status still identifies an upstream quota response without JSON. */ }
    if (payload?.code === 'rate_limited' || error.context.status === 429) {
      const headerRetry = Number(error.context.headers?.get('Retry-After'));
      const retryAfterSeconds = Math.max(0, Number(payload?.retryAfterSeconds) || headerRetry || 0);
      throw new AssistantRateLimitError('SNAP’s online request limit has been reached.', retryAfterSeconds);
    }
    // Vendor responses may contain implementation details. Keep user feedback app-branded.
    throw new Error('SNAP is temporarily unavailable. Local results are still available.');
  }
  if (error instanceof Error) throw new Error(snapText(error.message));
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
    text: snapText(data.text.trim()),
    dormIds: Array.isArray(data.dormIds) ? data.dormIds.filter((id: unknown) => typeof id === 'string') : [],
  };
}

const demandCache = new Map<string, { expires: number; value: Promise<GeminiDemandPrediction[]> }>();

const recommendationCache = new Map<string, { expires: number; value: Promise<string[]> }>();
let recommendationCooldown = 0;
/** Cache by account + this account's filters, never by another renter's prompt history. */
export async function rankAlternativesWithGemini(userId: string, candidates: Dorm[], filters: DormFilters, preferences: DormPreferences | null, origin: UserCoordinates | null) {
  if (recommendationCooldown > Date.now()) throw new AssistantRateLimitError('Local recommendations are available while the online assistant rests.');
  const ids = candidates.slice(0,20).map((dorm) => dorm.dorm_id);
  const key = JSON.stringify([userId, ids, filters, preferences, origin, candidates.map((dorm) => [dorm.price,dorm.rating_average,dorm.rating_count])]);
  const previous = recommendationCache.get(key);
  if (previous && previous.expires > Date.now()) return previous.value;
  if (recommendationCache.size > 20) recommendationCache.clear();
  const value = (async () => {
    const { data, error } = await supabase.functions.invoke('dorm-assistant', { body: { action: 'recommend', dormIds: ids, filters, origin: origin ? { latitude: origin.latitude, longitude: origin.longitude } : null } });
    if (error) await throwAssistantError(error);
    if (!Array.isArray(data?.dormIds)) throw new Error('The recommendation response was invalid.');
    return [...new Set<string>(data.dormIds.filter((id: unknown) => typeof id === 'string' && ids.includes(id)))];
  })();
  recommendationCache.set(key, { expires: Date.now() + 15 * 60 * 1000, value });
  try { return await value; } catch (error) {
    recommendationCache.delete(key);
    if (error instanceof AssistantRateLimitError) recommendationCooldown = Date.now() + Math.max(60,error.retryAfterSeconds || 60) * 1000;
    throw error;
  }
}

export async function predictDormDemand(dormIds: string[], factsKey = '', userId = ''): Promise<GeminiDemandPrediction[]> {
  const key = userId + dormIds.slice().sort().join('|') + factsKey;
  const cached = demandCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (demandCooldown > Date.now()) throw new AssistantRateLimitError('History-based estimates remain available while the online assistant rests.');
  if (demandCache.size > 20) demandCache.clear();
  const value = fetchDormDemand(dormIds);
  demandCache.set(key, { expires: Date.now() + 10 * 60 * 1000, value });
  try { return await value; } catch (error) {
    demandCache.delete(key);
    if (error instanceof AssistantRateLimitError) demandCooldown = Date.now() + Math.max(60,error.retryAfterSeconds || 60) * 1000;
    throw error;
  }
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
      reason: snapText(String(item.reason || '')).slice(0, 180),
    }));
}
