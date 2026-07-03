import { View, Text, StyleSheet, ScrollView, Linking, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function AboutUs() {
  const insets = useSafeAreaInsets();
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 40 }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>About SNAP</Text>
        <Text style={styles.subtitle}>Samuel Nina Angel Parba</Text>
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
        <Text style={styles.description}>Have questions or feedback? We'd love to hear from you!</Text>

        <View style={styles.buttonContainer}>
          <Pressable style={styles.linkButton} onPress={() => openLink('mailto:snap@uclm.edu')}>
            <Text style={styles.linkButtonText}>Email Us</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => openLink('https://snap.uclm.edu')}>
            <Text style={styles.linkButtonText}>Visit Website</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => openLink('https://github.com/snap/room-scout/issues')}>
            <Text style={styles.linkButtonText}>Report Issue</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>© 2026 SNAP — All Rights Reserved</Text>
      </View>
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
});
