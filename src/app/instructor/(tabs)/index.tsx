import { router } from 'expo-router';
import { Alert, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashTitle, DashTopBar, Panel, PanelLink, PanelRow, StatGrid } from '@/components/dashboard';
import { OfficialClassCard, termDates, termPhase, useTimetable, weeklyHours } from '@/components/official-schedule';
import { UploadStatus } from '@/components/upload-status';
import { OfflineNote, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { useAuth } from '@/lib/auth';
import { fmtToday, isoWeekday } from '@/lib/format';
import { OMR_STATUS } from '@/lib/omr';

export default function InstructorHome() {
  const { signOut } = useAuth();
  const { data, offline, savedAt, refresh } = useClasses();
  const classes = data ?? [];
  const timetable = useTimetable();
  const term = timetable.data?.term;
  const phase = termPhase(term);
  const official = phase === 'ended' ? [] : (timetable.data?.classes ?? []);
  const sections = new Set(official.map((c) => c.section_name)).size;
  const totals = classes.reduce((t, c) => ({ students: t.students + c.students, assignments: t.assignments + c.assignments }), { students: 0, assignments: 0 });
  const todays = phase === 'upcoming' ? [] : official.filter((c) => c.day_of_week === isoWeekday()).sort((a, b) => a.start_time.localeCompare(b.start_time));

  const confirmSignOut = () =>
    Alert.alert('Log out?', 'You can log back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);

  const termLine = term ? `${term.current_semester}, AY ${term.current_academic_year}${termDates(term) ? ` · ${termDates(term)}` : ''}` : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <Screen
        onRefresh={() => {
          refresh();
          timetable.refresh();
        }}>
        <DashTopBar role="Instructor" onSignOut={confirmSignOut} onBell={() => router.push('/instructor/notifications')} />
        <DashTitle title="Dashboard" subtitle={[fmtToday(), termLine].filter(Boolean).join(' · ')} />

        <OfflineNote show={offline} savedAt={savedAt} />
        <UploadStatus />

        <StatGrid
          items={[
            { label: 'My classes', value: classes.length, sub: `${sections} section${sections === 1 ? '' : 's'}` },
            { label: 'Students', value: totals.students, sub: 'Across all classes' },
            { label: 'Assignments', value: totals.assignments, sub: 'Posted' },
            { label: 'Teaching load', value: `${weeklyHours(official)} h`, sub: 'Per week' },
          ]}
        />

        <Panel title="Today’s classes" right={<PanelLink label="Full schedule" onPress={() => router.push('/instructor/schedule')} />} pad>
          {todays.length ? (
            todays.map((c) => <OfficialClassCard key={c.id} c={c} viewer="instructor" />)
          ) : (
            <Text style={{ color: colors.textSoft, fontSize: 13 }}>
              {phase === 'ended'
                ? 'The semester has ended.'
                : phase === 'upcoming'
                  ? 'The semester hasn’t started yet.'
                  : official.length
                    ? 'No classes today.'
                    : 'No official classes assigned yet. Your administrator assigns subjects and sections.'}
            </Text>
          )}
        </Panel>

        <Panel title="Quick access">
          <PanelRow icon="create-outline" title="Create quiz / exam" body="Build an assessment for your class" onPress={() => router.push('/instructor/quiz/new')} />
          <PanelRow icon="document-attach-outline" title="Post assignment" body="Share the next learning activity" onPress={() => router.push('/instructor/assignment')} />
          <PanelRow icon="megaphone-outline" title="Announcements" body="Keep your class in the loop" onPress={() => router.push('/instructor/announcement')} />
          <PanelRow icon="bar-chart-outline" title="Monitor results" body="Review scores and completion" onPress={() => router.push('/instructor/results')} />
          <PanelRow icon="people-outline" title="Manage classes" body="Students, activities and settings" onPress={() => router.push('/instructor/classes')} last />
        </Panel>

        {OMR_STATUS === 'planned' ? (
          <Text style={{ color: colors.textSoft, fontSize: 12 }}>
            Paper answer sheets (OMR) are planned but not available yet. Students answer quizzes in the app and scores are computed automatically.
          </Text>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}
