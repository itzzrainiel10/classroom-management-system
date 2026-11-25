import { router } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashTitle, DashTopBar, Panel, PanelLink, PanelRow, StatGrid } from '@/components/dashboard';
import { ChooseSectionCard } from '@/components/section-picker';
import { OfficialClassCard, inSession, termPhase, useTimetable } from '@/components/official-schedule';
import { UploadStatus } from '@/components/upload-status';
import { Button, OfflineNote, ProgressBar, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useStudentHome } from '@/hooks/use-student';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtToday } from '@/lib/format';

export default function StudentHome() {
  const { signOut } = useAuth();
  const { data, offline, savedAt, refresh } = useStudentHome();
  const quizzes = data?.quizzes ?? [];
  const timetable = useTimetable();
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const term = timetable.data?.term;
  const phase = termPhase(term);
  const section = timetable.data?.section;
  const todays = inSession(term, new Date())
    ? (timetable.data?.classes ?? []).filter((c) => c.day_of_week === today).sort((a, b) => a.start_time.localeCompare(b.start_time))
    : [];
  const done = quizzes.filter((q) => q.attempts.length > 0).length;
  const progress = quizzes.length ? done / quizzes.length : 0;
  const next = quizzes.filter((q) => q.attempts.length === 0).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))[0];

  const confirmSignOut = () =>
    Alert.alert('Log out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);

  const termLine = term ? `${term.current_semester}, AY ${term.current_academic_year}` : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <Screen
        onRefresh={() => {
          refresh();
          timetable.refresh();
        }}>
        <DashTopBar role="Student" onSignOut={confirmSignOut} onBell={() => router.push('/student/notifications')} />
        <DashTitle title="Dashboard" subtitle={[fmtToday(), termLine, section?.name].filter(Boolean).join(' · ')} />

        <OfflineNote show={offline} savedAt={savedAt} />
        <UploadStatus />
        {timetable.data && !section ? <ChooseSectionCard onChosen={timetable.refresh} /> : null}

        <StatGrid
          items={[
            { label: 'My classes', value: data?.classes.length ?? 0, sub: section?.name ?? 'No section yet' },
            { label: 'Classes today', value: todays.length, sub: fmtToday().split(',')[0] },
            { label: 'Quizzes done', value: `${done}/${quizzes.length}`, sub: `${Math.round(progress * 100)}% complete` },
            { label: 'Quizzes to take', value: quizzes.length - done, sub: next?.due_at ? `Next due ${fmtDate(next.due_at)}` : 'Nothing due' },
          ]}
        />

        {next ? (
          <Panel title="Next quiz" pad>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{next.title}</Text>
            <Text style={{ fontSize: 12, color: colors.textSoft }}>
              {next.class?.code} · Due {fmtDate(next.due_at)} · {next.time_limit_minutes} minutes
            </Text>
            <View style={{ gap: 4 }}>
              <ProgressBar value={progress} tone="green" />
            </View>
            <Button title="Take quiz" small onPress={() => router.push(`/student/quiz/${next.id}`)} />
          </Panel>
        ) : null}

        <Panel title="Today’s classes" right={<PanelLink label="Full schedule" onPress={() => router.push('/student/schedule')} />} pad>
          {todays.length ? (
            todays.map((c) => <OfficialClassCard key={c.id} c={c} viewer="student" />)
          ) : (
            <Text style={{ color: colors.textSoft, fontSize: 13 }}>
              {!section
                ? 'Choose your section above to see your classes.'
                : phase === 'ended'
                  ? 'The semester has ended.'
                  : phase === 'upcoming'
                    ? 'The semester hasn’t started yet. See Schedule for your upcoming classes.'
                    : 'No classes today.'}
            </Text>
          )}
        </Panel>

        <Panel title="Menu">
          <PanelRow icon="book-outline" title="My classes" body="Your learning, all in one place" badge={data ? String(data.classes.length) : undefined} onPress={() => router.push('/student/classes')} />
          <PanelRow icon="create-outline" title="Quizzes" body="Answer quizzes and see your scores" onPress={() => router.push('/student/quizzes')} />
          <PanelRow icon="document-text-outline" title="Assignments" body="Keep track of your coursework" onPress={() => router.push('/student/assignments')} />
          <PanelRow icon="megaphone-outline" title="Announcements" body="The latest from your instructors" onPress={() => router.push('/student/announcements')} />
          <PanelRow icon="calendar-outline" title="Schedule" body="Week and month view" onPress={() => router.push('/student/schedule')} last />
        </Panel>
      </Screen>
    </SafeAreaView>
  );
}
