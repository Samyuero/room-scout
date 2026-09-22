import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, Pressable, Platform } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'renter' | 'owner'>('renter');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSignUp = async () => {
    if (!username.trim() || username.trim().length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters.');
      return;
    }

    setLoading(true);
    try {
      // Check username uniqueness across all tables first
      const cleanUsername = username.toLowerCase().trim();
      const [renters, owners, admins] = await Promise.all([
        supabase.from('renters').select('username').eq('username', cleanUsername).maybeSingle(),
        supabase.from('owners').select('username').eq('username', cleanUsername).maybeSingle(),
        supabase.from('admins').select('username').eq('username', cleanUsername).maybeSingle()
      ]);

      const existing = renters.data || owners.data || admins.data;

      if (existing) {
        Alert.alert('Error', 'That username is already taken. Please choose another.');
        setLoading(false);
        return;
      }

      // Sign up (email confirmation is OFF, so user is auto-logged-in)
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username: username.toLowerCase().trim(),
            role: role,
          }
        }
      });

      if (error) throw error;

      // Ensure profile row exists in the correct table (owners or renters)
      if (data?.user) {
        if (role === 'owner') {
          await supabase.from('owners').upsert({
            owner_id: data.user.id,
            username: username.toLowerCase().trim(),
            full_name: fullName,
            updated_at: new Date().toISOString()
          });
        } else {
          await supabase.from('renters').upsert({
            renter_id: data.user.id,
            username: username.toLowerCase().trim(),
            full_name: fullName,
            updated_at: new Date().toISOString()
          });
        }
      }

      // Profile will be created automatically by trigger when user is created in auth
      // Navigate to home directly (email confirmation is disabled)
      router.replace('/' as any);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    try {
      // Determine redirect URL based on platform
      let redirectTo: string;
      if (Platform.OS === 'web') {
        // On web, we want to redirect the current window to the OAuth provider
        redirectTo = `${window.location.origin}/auth/callback`;
      } else {
        // On native, we use our custom scheme
        redirectTo = 'roomscout://google-auth';
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            role: role,
          },
        },
      });

      if (error) throw error;

      if (Platform.OS === 'web') {
        // On web, the signInWithOAuth method will redirect the window to the OAuth provider.
        // We don't need to do anything else here; the window will navigate away.
        return;
      }

      // On native, we use WebBrowser to open the URL and then handle the result.
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          const { url } = result;
          const params = url.split('#')[1] || url.split('?')[1];
          if (params) {
            const dict: { [key: string]: string } = {};
            params.split('&').forEach((pair) => {
              const [k, v] = pair.split('=');
              dict[k] = decodeURIComponent(v);
            });
            if (dict.access_token && dict.refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token: dict.access_token,
                refresh_token: dict.refresh_token,
              });
              if (sessionError) throw sessionError;
              // Redirect to index which checks for username
              router.replace('/' as any);
            }
          }
        }
      }
    } catch (error: any) {
      Alert.alert('Google Sign-Up Error', error.message);
    } finally {
      // Only set loading to false if we are not on web (because on web we redirect and the component unmounts)
      if (Platform.OS !== 'web') {
        setGoogleLoading(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Enter your full name"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Choose a username (min 3 chars)"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Enter your email"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Create a password"
          secureTextEntry
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>I am a...</Text>
        <View style={styles.roleContainer}>
          <Pressable
            style={[styles.roleButton, role === 'renter' && styles.roleButtonActive]}
            onPress={() => setRole('renter')}
          >
            <Text style={[styles.roleText, role === 'renter' && styles.roleTextActive]}>Student / Renter</Text>
          </Pressable>
          <Pressable
            style={[styles.roleButton, role === 'owner' && styles.roleButtonActive]}
            onPress={() => setRole('owner')}
          >
            <Text style={[styles.roleText, role === 'owner' && styles.roleTextActive]}>Dorm Owner</Text>
          </Pressable>
        </View>
      </View>

      <Button
        title={loading ? 'Creating account...' : 'Sign Up'}
        onPress={handleSignUp}
        disabled={loading || googleLoading}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.googleButton,
          pressed && { opacity: 0.8 },
          (loading || googleLoading) && { backgroundColor: '#ccc' }
        ]}
        onPress={handleGoogleSignUp}
        disabled={loading || googleLoading}
      >
        <Text style={styles.googleButtonText}>
          {googleLoading ? 'Connecting...' : 'Sign Up with Google'}
        </Text>
      </Pressable>

      <Text style={styles.link} onPress={() => {
        router.push('/(auth)/sign-in' as any);
      }}>
        Already have an account? Sign in
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  link: {
    marginTop: 20,
    textAlign: 'center',
    color: '#007AFF',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#999',
    fontSize: 14,
  },
  googleButton: {
    backgroundColor: '#4285F4',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  roleButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    alignItems: 'center',
  },
  roleButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#e6f2ff',
  },
  roleText: {
    color: '#555',
    fontWeight: '600',
  },
  roleTextActive: {
    color: '#007AFF',
  },
});
