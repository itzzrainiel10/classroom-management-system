import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroBackdrop, HeroTopBar } from '@/components/hero';
import { MenuRow } from '@/components/menu-row';
import { TermBanner, termPhase, useTimetable, weeklyHours } from '@/components/official-schedule';
import { UploadStatus } from '@/components/upload-status';
import { Card, Label, OfflineNote, OnPrimary, Screen } from '@/components/ui';
import { colors, radius, shadow } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { useAuth } from '@/lib/auth';
import { firstName, fmtToday, greetingFor } from '@/lib/format';
import { OMR_STATUS } from '@/lib/omr';

export default function InstructorHome() {
  const { fullName, signOut } = useAuth();
  const { data, offline, savedAt, refresh } = useClasses();
  const classes = data ?? [];
  const timetable = useTimetable();
  const official = termPhase(timetable.data?.term) === 'ended' ? [] : (timetable.data?.classes ?? []);
  const subjects = new Set(official.map((c) => c.subject_code)).size;
  const sections = [...new Set(official.map((c) => c.section_name))];
  const totals = classes.reduce((t, c) => ({ students: t.students + c.students, assignments: t.assignments + c.assignments }), { students: 0, assignments: 0 });

  const confirmSignOut = () =>
    Alert.alert('Log out?', 'You can log back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <View style={styles.hero}>
          <HeroBackdrop />
          <HeroTopBar role="Instructor" onSignOut={confirmSignOut} onBell={() => router.push('/instructor/notifications')} />
          <OnPrimary size="lg">
            {greetingFor()}
            {fullName ? `, ${firstName(fullName)}` : ''}!
          </OnPrimary>
          <OnPrimary>{fmtToday()} · Here’s what’s happening today.</OnPrimary>
          <View style={styles.stats}>
            <Stat n={classes.length} label="Classes" />
            <View style={styles.divider} />
            <Stat n={totals.assignments} label="Assignments" />
            <View style={styles.divider} />
            <Stat n={totals.students} label="Students" />
          </View>
        </View>

        <OfflineNote show={offline} savedAt={savedAt} />
        <UploadStatus />

        <Card style={{ gap: 10 }}>
          <Label>Teaching load</Label>
          <TermBanner term={timetable.data?.term} />
          {official.length ? (
            <>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
                {subjects} subject{subjects === 1 ? '' : 's'} · {sections.length} section{sections.length === 1 ? '' : 's'} · {weeklyHours(official)} hours/week
              </Text>
              <Text style={{ color: colors.textSoft, fontSize: 13 }}>{sections.join(', ')}</Text>
            </>
          ) : (
            <Text style={{ color: colors.textSoft, fontSize: 13 }}>No official classes assigned yet. Your administrator assigns subjects and sections.</Text>
          )}
          <MenuRow icon="calendar" title="Teaching schedule" body="Subjects, sections, rooms and times." onPress={() => router.push('/instructor/schedule')} />
        </Card>

        <Label>Quick access</Label>
        <View style={{ gap: 10 }}>
          <MenuRow icon="create" title="Create Quiz / Exams" body="Build an assessment for your class." onPress={() => router.push('/instructor/quiz/new')} />
          <MenuRow icon="document-attach" title="Post Assignments" body="Share the next learning activity." onPress={() => router.push('/instructor/assignment')} />
          <MenuRow icon="megaphone" title="Announcements" body="Keep your class in the loop." onPress={() => router.push('/instructor/announcement')} />
          <MenuRow icon="calendar" title="Class Schedule" body="Plan your week of teaching." onPress={() => router.push('/instructor/schedule')} />
          <MenuRow icon="bar-chart" title="Monitor Results" body="Review scores and completion." onPress={() => router.push('/instructor/results')} />
          <MenuRow icon="people" title="Manage classes" body="Students, activities & settings." onPress={() => router.push('/instructor/classes')} />
        </View>

        <Card tone="soft" style={{ gap: 4 }}>
          <Text style={{ fontWeight: '800', color: colors.primary }}>Paper answer sheets (OMR)</Text>
          <Text style={{ color: colors.textSoft, fontSize: 13 }}>
            {OMR_STATUS === 'planned'
              ? 'Planned — not available yet. Students currently answer quizzes in the app and scores are computed automatically.'
              : 'Available'}
          </Text>
        </Card>
      </Screen>
    </SafeAreaView>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, marginHorizontal: -20, marginTop: -20, padding: 20, paddingTop: 12, paddingBottom: 26, gap: 6, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden' },
  stats: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: 16, marginTop: 16, ...shadow.lg },
  divider: { width: 1, height: 28, backgroundColor: colors.line },
  statN: { fontSize: 24, fontWeight: '800', color: colors.primary, letterSpacing: -0.5 },
  statL: { fontSize: 12, color: colors.textSoft, fontWeight: '600' },
});
