import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroBackdrop, HeroTopBar } from '@/components/hero';
import { MenuRow } from '@/components/menu-row';
import { RenewalCardView, useRenewalState } from '@/components/renewal-card';
import { SemesterEndedCard, useSemesterEnded } from '@/components/semester';
import { OfficialClassCard, TermBanner, inSession, termPhase, useTimetable } from '@/components/official-schedule';
import { UploadStatus } from '@/components/upload-status';
import { Button, Caption, Card, H2, Label, OfflineNote, OnPrimary, ProgressBar, Screen } from '@/components/ui';
import { colors, radius, shadow, themed } from '@/constants/theme';
import { useStudentHome } from '@/hooks/use-student';
import { useAuth } from '@/lib/auth';
import { firstName, fmtDate } from '@/lib/format';

export default function StudentHome() {
  const { fullName, loginProvider } = useAuth();
  // Between semesters Home shows only the semester-ended card (and renewal), nothing else.
  const ended = useSemesterEnded();
  const { data, offline, savedAt, refresh } = useStudentHome();
  const renewal = useRenewalState();
  const quizzes = data?.quizzes ?? [];
  const timetable = useTimetable();
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const phase = termPhase(timetable.data?.term);
  const todays = inSession(timetable.data?.term, new Date()) ? (timetable.data?.classes ?? []).filter((c) => c.day_of_week === today) : [];
  const done = quizzes.filter((q) => q.attempts.length > 0).length;
  const progress = quizzes.length ? done / quizzes.length : 0;
  const next = quizzes.filter((q) => q.attempts.length === 0).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))[0];
  const onlyRenewal = loginProvider === 'google' && ((renewal.loading && !renewal.data) || Boolean(renewal.data?.open && !renewal.data.renewal));

  if (onlyRenewal) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
        <Screen onRefresh={renewal.refresh}>
          <View style={styles.hero}>
            <HeroBackdrop />
            <HeroTopBar role="Student" onSettings={() => router.push('/settings')} onBell={() => router.push('/student/notifications')} />
            <OnPrimary size="lg">Renew your enrollment</OnPrimary>
            <OnPrimary>Complete your renewal to access your dashboard.</OnPrimary>
          </View>
          {renewal.data ? (
            <RenewalCardView role="student" data={renewal.data} />
          ) : (
            <Card style={{ gap: 8 }}>
              <Label>Checking your renewal</Label>
              <Caption>Loading your semester renewal status.</Caption>
            </Card>
          )}
        </Screen>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <View style={styles.hero}>
          <HeroBackdrop />
          <HeroTopBar role="Student" onSettings={() => router.push('/settings')} onBell={() => router.push('/student/notifications')} />
          <OnPrimary size="lg">Hello, {fullName ? firstName(fullName) : 'Student'}!</OnPrimary>
          <OnPrimary>Welcome back. Keep moving forward.</OnPrimary>
          {ended ? null : (
          <View style={styles.progress}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.progressLabel}>Your progress</Text>
              <Text style={styles.progressValue}>{Math.round(progress * 100)}%</Text>
            </View>
            <ProgressBar value={progress} />
            <Caption>
              {done} of {quizzes.length} quizzes completed{progress >= 0.8 ? ' · Keep going!' : ''}
            </Caption>
          </View>
          )}
        </View>

        <OfflineNote show={offline} savedAt={savedAt} />
        <UploadStatus />

        <SemesterEndedCard role="student" />
        <RenewalCardView role="student" data={renewal.data} />
        {ended ? null : (
          <>
        <Card style={{ gap: 10 }}>
          <Label>Today’s classes</Label>
          <TermBanner term={timetable.data?.term} extra={timetable.data?.section?.name ?? 'No section yet'} />
          {todays.length ? (
            todays.map((c) => <OfficialClassCard key={c.id} c={c} viewer="student" />)
          ) : (
            <Caption>
              {!timetable.data?.section
                ? 'Choose your section above to see your classes.'
                : phase === 'ended'
                  ? 'The semester has ended.'
                  : phase === 'upcoming'
                    ? 'The semester hasn’t started yet. See Schedule for your upcoming classes.'
                    : 'No classes today.'}
            </Caption>
          )}
        </Card>

        {next ? (
          <Card tone="gold" style={{ gap: 8 }}>
            <Label style={{ color: colors.text }}>Upcoming activity</Label>
            <H2>Quiz: {next.title}</H2>
            <Caption style={{ color: colors.text }}>
              {next.class?.code} · Due {fmtDate(next.due_at)} · {next.time_limit_minutes} minutes
            </Caption>
            <Button title="Take quiz" iconRight="arrow-forward" small onPress={() => router.push(`/student/quiz/${next.id}`)} />
          </Card>
        ) : null}

        <Label>Your menu</Label>
        <View style={{ gap: 10 }}>
          <MenuRow icon="book" title="My Classes" body="Your learning, all in one place." onPress={() => router.push('/student/classes')} badge={data ? String(data.classes.length) : undefined} />
          <MenuRow icon="create" title="Quizzes" body="Answer quizzes and see your scores." onPress={() => router.push('/student/quizzes')} />
          <MenuRow icon="document-text" title="Assignments" body="Keep track of your coursework." onPress={() => router.push('/student/assignments')} />
          <MenuRow icon="megaphone" title="Announcements" body="The latest from your instructor." onPress={() => router.push('/student/announcements')} />
          <MenuRow icon="checkmark-done" title="Attendance" body="Your attendance in each class." onPress={() => router.push('/student/attendance')} />
          <MenuRow icon="calendar" title="Schedule" body="Your week at a glance." onPress={() => router.push('/student/schedule')} />
          <MenuRow icon="archive" title="My Semesters" body="Grades and attendance from past semesters." onPress={() => router.push('/student/semesters')} />
        </View>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  hero: { backgroundColor: colors.primary, marginHorizontal: -20, marginTop: -20, padding: 20, paddingTop: 12, paddingBottom: 26, gap: 6, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden' },
  progress: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10, marginTop: 16, ...shadow.lg },
  progressLabel: { fontWeight: '800', color: colors.text },
  progressValue: { fontWeight: '800', color: colors.primary },
}));
