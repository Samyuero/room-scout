import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRouter } from 'expo-router';

export default function SetupUsername() {
  const router = useRouter();
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  const checkUsernameAvailability = async (text: string) => {
    setUsername(text);
    if (text.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    setChecking(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', text.toLowerCase().trim())
        .maybeSingle();

      if (error) throw error;
      setUsernameAvailable(!data); // available if no existing row
    } catch (err) {
      console.error('Error checking username:', err);
      setUsernameAvailable(null);
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be signed in.');
      return;
    }
    if (username.trim().length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters.');
      return;
    }
    if (!usernameAvailable) {
      Alert.alert('Error', 'That username is already taken. Please choose another.');
      return;
    }

    setLoading(true);
    try {
      const cleanUsername = username.toLowerCase().trim();

      // Get user metadata for full_name and avatar
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || '';
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';

      // Check if a profile row already exists (Google sign-in may not have one)
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('profile_id', user.id)
        .maybeSingle();

      if (existingProfile) {
        // Update existing profile with username
        const { error } = await supabase
          .from('profiles')
          .update({
            username: cleanUsername,
            full_name: fullName || undefined,
            avatar_url: avatarUrl || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('profile_id', user.id);

        if (error) throw error;
      } else {
        // Insert new profile row
        const { error } = await supabase.from('profiles').insert({
          profile_id: user.id,
          username: cleanUsername,
          full_name: fullName,
          avatar_url: avatarUrl,
          role: 'user',
        });

        if (error) throw error;
      }

      // Navigate to home
      router.replace('/(tabs)/home' as any);
    } catch (error: any) {
      if (error.message?.includes('unique') || error.code === '23505') {
        Alert.alert('Error', 'That username is already taken. Please choose another.');
      } else {
        Alert.alert('Error', error.message || 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose Your Username</Text>
      <Text style={styles.subtitle}>
        Pick a unique username to complete your profile setup.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={[
            styles.input,
            usernameAvailable === true && styles.inputValid,
            usernameAvailable === false && styles.inputInvalid,
          ]}
          value={username}
          onChangeText={checkUsernameAvailability}
          placeholder="Enter a unique username"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {checking && (
          <Text style={styles.checkingText}>Checking availability...</Text>
        )}
        {!checking && usernameAvailable === true && username.length >= 3 && (
          <Text style={styles.availableText}>✓ Username is available!</Text>
        )}
        {!checking && usernameAvailable === false && username.length >= 3 && (
          <Text style={styles.takenText}>✗ Username is already taken</Text>
        )}
        {username.length > 0 && username.length < 3 && (
          <Text style={styles.hintText}>Username must be at least 3 characters</Text>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.submitButton,
          pressed && { opacity: 0.8 },
          (!usernameAvailable || loading) && styles.submitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={!usernameAvailable || loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Continue</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 32,
    lineHeight: 22,
  },
  inputGroup: {
    marginBottom: 24,
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
    padding: 14,
    fontSize: 16,
  },
  inputValid: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  inputInvalid: {
    borderColor: '#ef4444',
    borderWidth: 2,
  },
  checkingText: {
    marginTop: 6,
    fontSize: 13,
    color: '#999',
  },
  availableText: {
    marginTop: 6,
    fontSize: 13,
    color: '#22c55e',
    fontWeight: '600',
  },
  takenText: {
    marginTop: 6,
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  hintText: {
    marginTop: 6,
    fontSize: 13,
    color: '#f59e0b',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
