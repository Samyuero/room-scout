import { supabase } from './supabase';

/**
 * Get dorms with optional filters
 */
export const getDorms = async (filters: {
  available?: boolean;
  minPrice?: number;
  maxPrice?: number;
  genderPolicy?: string;
  query?: string;
  limit?: number;
  offset?: number;
} = {}) => {
  let query = supabase.from('dorms').select('*');

  if (filters.available !== undefined) {
    query = query.eq('available', filters.available);
  }

  if (filters.minPrice !== undefined) {
    query = query.gte('price', filters.minPrice);
  }

  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice);
  }

  if (filters.genderPolicy) {
    query = query.eq('gender_policy', filters.genderPolicy);
  }

  if (filters.query) {
    query = query.or(`name.ilike.%${filters.query}%,address.ilike.%${filters.query}%`);
  }

  if (filters.limit !== undefined) {
    query = query.limit(filters.limit);
  }

  if (filters.offset !== undefined) {
    const limit = filters.limit || 10;
    query = query.range(filters.offset, filters.offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

/**
 * Get a single dorm by ID
 */
export const getDormById = async (id: string) => {
  const { data, error } = await supabase
    .from('dorms')
    .select('*')
    .eq('dorm_id', id)
    .single();

  if (error) throw error;
  return data;
};

/**
 * Create a new dorm
 */
export const createDorm = async (dormData: any) => {
  const { data, error } = await supabase
    .from('dorms')
    .insert([dormData])
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Update a dorm
 */
export const updateDorm = async (id: string, updates: any) => {
  const { data, error } = await supabase
    .from('dorms')
    .update(updates)
    .eq('dorm_id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Delete a dorm
 */
export const deleteDorm = async (id: string) => {
  const { error } = await supabase
    .from('dorms')
    .delete()
    .eq('dorm_id', id);

  if (error) throw error;
};

/**
 * Get reviews for a dorm
 */
export const getDormReviews = async (dormId: string) => {
  const { data, error } = await supabase
    .from('dorm_reviews')
    .select('*')
    .eq('dorm_id', dormId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

/**
 * Add a review for a dorm
 */
export const addDormReview = async (dormId: string, userId: string, rating: number, comment: string) => {
  const { data, error } = await supabase
    .from('dorm_reviews')
    .insert({
      dorm_id: dormId,
      user_id: userId,
      rating,
      comment,
    });

  if (error) throw error;
  return data;
};

/**
 * Get user's dorms
 */
export const getUserDorms = async (userId: string) => {
  const { data, error } = await supabase
    .from('dorms')
    .select('*')
    .eq('owner_id', userId);

  if (error) throw error;
  return data;
};
