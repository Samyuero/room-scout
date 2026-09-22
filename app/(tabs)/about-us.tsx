import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Pressable, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export default function AboutUs() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [reportVisible, setReportVisible] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Edit these four records to update the team section; no other files are required.
  const teamMembers = [
    { id: 1, name: 'Angel Faye A. Parba', role: 'Project Manager', bio: 'Responsible for overall project management and coordination.' },
    { id: 2, name: 'Samuel L. Capuras', role: 'Lead Developer', bio: 'Lead developer responsible for the mobile application development.' },
    { id: 3, name: 'Nina Joy L. Tamayo', role: 'UI/UX Designer', bio: 'Designed the user interface and user experience of the application.' },
    { id: 4, name: 'Princess Reyna Joy P. Regidor', role: 'Quality Assurance', bio: 'Ensured the quality and reliability of the application through testing.' },
  ];

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.error('Error opening URL:', e);
    }
  };

  const submitReport = async () => {
    const safeSubject = subject.trim().slice(0, 120);
    const safeDescription = description.trim().slice(0, 2000);
    if (!safeSubject || !safeDescription) {
      Alert.alert('Add details', 'Please provide a short subject and a description of the issue.');
      return;
    }
    if (!user) {
      Alert.alert('Sign in required', 'Sign in first so the SNAP team can follow up on your report.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        subject: safeSubject,
        description: safeDescription,
      });
      if (error) throw error;
      setReportVisible(false);
      setSubject('');
      setDescription('');
      Alert.alert('Report sent', 'Thank you. The SNAP team can now review your report in the admin panel.');
    } catch (error) {
      console.error('Support ticket submission failed:', error);
      Alert.alert('Could not send report', 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 40 }}
    >
      <View style={styles.header}>
        <Image source={require('../../assets/logo.png')} contentFit="contain" style={styles.logoSlot} />
        <Text style={styles.title}>About SNAP</Text>
        <Text style={styles.subtitle}>Four students, one safer way home.</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Our Mission</Text>
        <Text style={styles.description}>
          SNAP is dedicated to helping students find safe, affordable, and convenient housing near
          universities. We strive to make the housing search process transparent, efficient, and
          student-friendly.
        </Text>

        <Text style={styles.sectionTitle}>Our Team</Text>
        <Text style={styles.description}>
          We are a team of 4 dedicated IT students from UCLM who came together to create a solution
          for the common problem of finding suitable accommodation challenges faced by students.
        </Text>

        {teamMembers.map((member) => (
          <View key={member.id} style={styles.teamMember}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{member.name.charAt(0)}</Text>
            </View>
            <View style={styles.teamInfo}>
              <Text style={styles.teamName}>{member.name}</Text>
              <Text style={styles.teamRole}>{member.role}</Text>
              <Text style={styles.teamBio}>{member.bio}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Contact Us</Text>
        <Text style={styles.description}>Have questions or feedback? We&apos;d love to hear from you!</Text>

        <View style={styles.buttonContainer}>
          <Pressable style={styles.linkButton} onPress={() => openLink('mailto:snap@uclm.edu')}>
            <Text style={styles.linkButtonText}>Email Us</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => openLink('https://snap.uclm.edu')}>
            <Text style={styles.linkButtonText}>Visit Website</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setReportVisible(true)}>
            <Text style={styles.linkButtonText}>Report Issue</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>© 2026 SNAP — All Rights Reserved</Text>
      </View>

      <Modal visible={reportVisible} transparent animationType="fade" onRequestClose={() => setReportVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report an issue</Text>
            <Text style={styles.modalHelp}>Your report goes directly to the SNAP admin panel, not GitHub.</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              maxLength={120}
              placeholder="Short subject"
              placeholderTextColor={AppColors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              textAlignVertical="top"
              placeholder="What happened? Include steps to reproduce it if you can."
              placeholderTextColor={AppColors.textMuted}
              style={[styles.input, styles.descriptionInput]}
            />
            <View style={styles.modalActions}>
              <Pressable disabled={submitting} onPress={() => setReportVisible(false)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={submitting} onPress={submitReport} style={styles.submitButton}>
                {submitting ? <ActivityIndicator color={AppColors.white} /> : <Text style={styles.submitButtonText}>Send report</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    padding: 24,
    alignItems: 'center',
  },
  logoSlot: {
    width: 132,
    height: 104,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: AppColors.text,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: AppColors.textSecondary,
  },
  content: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 16,
    color: AppColors.text,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: AppColors.textSecondary,
    marginBottom: 8,
  },
  teamMember: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.lg,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    backgroundColor: AppColors.accent,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: AppColors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
    color: AppColors.text,
  },
  teamRole: {
    fontSize: 13,
    color: AppColors.accent,
    marginBottom: 6,
    fontWeight: '600',
  },
  teamBio: {
    fontSize: 13,
    color: AppColors.textSecondary,
    lineHeight: 19,
  },
  buttonContainer: {
    marginTop: 16,
    gap: 10,
  },
  linkButton: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  linkButtonText: {
    color: AppColors.text,
    fontWeight: '600',
    fontSize: 15,
  },
  footer: {
    textAlign: 'center',
    padding: 24,
    color: AppColors.textMuted,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  modalCard: {
    borderRadius: BorderRadius.lg,
    padding: 20,
    backgroundColor: AppColors.surface,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  modalTitle: { color: AppColors.text, fontSize: 20, fontWeight: '700' },
  modalHelp: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 16 },
  input: {
    color: AppColors.text,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.sm,
    padding: 12,
    marginBottom: 10,
  },
  descriptionInput: { minHeight: 120 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  cancelButton: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: BorderRadius.sm },
  cancelButtonText: { color: AppColors.textSecondary, fontWeight: '700' },
  submitButton: { minWidth: 116, alignItems: 'center', borderRadius: BorderRadius.sm, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: AppColors.accent },
  submitButtonText: { color: AppColors.white, fontWeight: '700' },
});
