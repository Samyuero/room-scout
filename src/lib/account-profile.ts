import { supabase } from '@/lib/supabase';

export const SIGNUP_ROLE_KEY = 'roomscout_pending_signup_role';

export interface AccountRegistration {
  completed: boolean;
  role: 'admin' | 'owner' | 'renter' | null;
  fullName: string;
  username: string;
  phone: string;
  avatarUrl: string;
}

/** Baseline renter rows support shared features; only a completed registration chooses a role. */
export async function getAccountRegistration(userId: string): Promise<AccountRegistration> {
  const [renter, owner, admin] = await Promise.all([
    supabase.from('renters').select('full_name,username,phone_number,avatar_url,registration_role,registration_completed_at').eq('renter_id', userId).maybeSingle(),
    supabase.from('owners').select('full_name,username,phone_number,avatar_url').eq('owner_id', userId).maybeSingle(),
    supabase.from('admins').select('full_name,username,phone_number,avatar_url').eq('admin_id', userId).maybeSingle(),
  ]);
  const error = renter.error || owner.error || admin.error;
  if (error) throw error;
  const profile = admin.data || owner.data || renter.data;
  return {
    completed: !!admin.data || !!renter.data?.registration_completed_at,
    role: admin.data ? 'admin' : owner.data ? 'owner' : renter.data?.registration_role || null,
    fullName: profile?.full_name || '', username: profile?.username || '',
    phone: profile?.phone_number || '', avatarUrl: profile?.avatar_url || '',
  };
}

/** Exchange the PKCE code returned to the APK (and accept legacy token links). */
export async function completeOAuthRedirect(url: string) {
  const redirect = new URL(url);
  const params = redirect.searchParams;
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  const providerError = params.get('error_description') || fragment.get('error_description');
  if (providerError || params.has('error') || fragment.has('error')) throw new Error('Google sign-in was not completed. Please try again.');
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else {
    const access_token = fragment.get('access_token') || params.get('access_token');
    const refresh_token = fragment.get('refresh_token') || params.get('refresh_token');
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
    } else {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error('Sign-in returned without a session. Please try again.');
    }
  }
  await completeGoogleProfile();
}

/** Completes only the signed-in account's profile after the Google redirect. */
export async function completeGoogleProfile() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Please sign in again to finish account setup.');
  const user = data.user;
  const profile = { full_name: user.user_metadata?.full_name || user.user_metadata?.name || null, avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null, updated_at: new Date().toISOString() };
  const { error: renterError } = await supabase.from('renters').upsert({ renter_id: user.id, ...profile }, { onConflict: 'renter_id', ignoreDuplicates: true });
  if (renterError) throw renterError;
  // Do not infer a role or complete registration here. New Google users confirm
  // their own name, username, role and phone in the account setup screen.
}
