import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import { findDormsFromPrompt } from '@/lib/dorm-assistant';
import { formatPeso } from '@/lib/dorm-discovery';
import type { Dorm } from '@/types/dorm';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  matches?: Dorm[];
}

const QUICK_PROMPTS = [
  'Find pet-friendly dorms under ₱5,000',
  'LGU certified within 5 km',
  'Female dorm with WiFi and motorcycle parking',
];

export default function Chat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { dorms, filters, location } = useDiscovery();
  const [input, setInput] = useState('');
  const messageSequence = useRef(0);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Tell me your budget, preferred area or radius, and must-have features. I use public listings only—do not send IDs, payment details, passwords, or OTPs here.',
    },
  ]);

  const canSend = input.trim().length > 0;
  const visiblePrompts = useMemo(() => messages.length === 1, [messages.length]);

  function send(text = input) {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    const result = findDormsFromPrompt(clean, dorms, filters, location);
    messageSequence.current += 1;
    const messageId = messageSequence.current;
    setMessages((current) => [
      ...current,
      { id: `user-${messageId}`, role: 'user', text: clean },
      { id: `assistant-${messageId}`, role: 'assistant', text: result.text, matches: result.matches },
    ]);
    setInput('');
  }

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.messages, { paddingBottom: 18 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.privacyBanner}>
          <Ionicons name="shield-checkmark-outline" size={18} color={AppColors.success} />
          <Text style={styles.privacyText}>Public listing assistant · no private renter data</Text>
        </View>

        {messages.map((message) => (
          <View key={message.id} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
            <Text selectable style={[styles.messageText, message.role === 'user' && styles.userText]}>{message.text}</Text>
            {message.matches?.map((dorm) => (
              <Pressable key={dorm.dorm_id} onPress={() => router.push(`/(tabs)/${dorm.dorm_id}` as never)} style={styles.matchCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchName} numberOfLines={1}>{dorm.name}</Text>
                  <Text style={styles.matchMeta}>{formatPeso(dorm.price)} · ★ {dorm.rating_average || 'New'}{dorm.distance_km !== null ? ` · ${dorm.distance_km} km` : ''}</Text>
                </View>
                <View style={styles.matchBadge}><Text style={styles.matchScore}>{dorm.ranking_score}</Text></View>
              </Pressable>
            ))}
          </View>
        ))}

        {visiblePrompts && (
          <View style={styles.quickSection}>
            <Text style={styles.quickTitle}>Try asking</Text>
            {QUICK_PROMPTS.map((prompt) => (
              <Pressable key={prompt} onPress={() => send(prompt)} style={styles.quickButton}>
                <Text style={styles.quickText}>{prompt}</Text>
                <Ionicons name="arrow-forward" size={15} color={AppColors.accent} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          multiline
          maxLength={500}
          value={input}
          onChangeText={setInput}
          placeholder="Example: under ₱6,000, within 3 km, pet friendly"
          placeholderTextColor={AppColors.textMuted}
          style={styles.input}
        />
        <Pressable disabled={!canSend} onPress={() => send()} style={[styles.sendButton, !canSend && styles.sendDisabled]}>
          <Ionicons name="send" size={18} color={AppColors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  messages: { padding: 16, gap: 12 },
  privacyBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.successBg, borderWidth: 1, borderColor: AppColors.success },
  privacyText: { flex: 1, color: AppColors.success, fontSize: 11, fontWeight: '700' },
  message: { maxWidth: '92%', padding: 13, gap: 10, borderRadius: BorderRadius.lg, borderCurve: 'continuous' },
  assistantMessage: { alignSelf: 'flex-start', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.borderSubtle },
  userMessage: { alignSelf: 'flex-end', backgroundColor: AppColors.accent },
  messageText: { color: AppColors.text, fontSize: 14, lineHeight: 20 },
  userText: { color: AppColors.white },
  matchCard: { minWidth: 260, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.border },
  matchName: { color: AppColors.text, fontSize: 13, fontWeight: '800' },
  matchMeta: { color: AppColors.textSecondary, fontSize: 10, marginTop: 3 },
  matchBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: AppColors.accentMuted },
  matchScore: { color: AppColors.white, fontSize: 12, fontWeight: '800' },
  quickSection: { gap: 8, marginTop: 4 },
  quickTitle: { color: AppColors.textSecondary, fontSize: 12, fontWeight: '700' },
  quickButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 12, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.surface },
  quickText: { flex: 1, color: AppColors.text, fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: AppColors.borderSubtle, backgroundColor: AppColors.surface },
  input: { flex: 1, maxHeight: 110, minHeight: 46, paddingHorizontal: 12, paddingVertical: 11, borderRadius: BorderRadius.md, color: AppColors.text, backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder, fontSize: 13 },
  sendButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: AppColors.accent },
  sendDisabled: { opacity: 0.4 },
});
