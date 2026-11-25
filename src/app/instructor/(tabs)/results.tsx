import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Button, Caption, Card, Empty, H2, Loading, OfflineNote, Pill, QuizStatusPill, ProgressBar, Row, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchQuizSummaries } from '@/lib/data';
import { fmtDate, pct } from '@/lib/format';

export default function InstructorResults() {
  const { data, loading, offline, savedAt, refresh } = useRemote('quiz-summaries', fetchQuizSummaries);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Instructor" title="Monitor Results" subtitle="Review scores and completion from the class reports." />
        <OfflineNote show={offline} savedAt={savedAt} />
        {loading && !data ? <Loading /> : null}
        {data && data.length === 0 ? (
          <Empty icon="bar-chart-outline" title="No quizzes yet" body="Create and publish a quiz; results appear here as students submit.">
            <Button title="Create quiz" icon="add" onPress={() => router.push('/instructor/quiz/new')} />
          </Empty>
        ) : null}
        {data?.map((q) => {
          const submitted = q.attempts.length;
          const avg = submitted ? q.attempts.reduce((s, a) => s + pct(a.score, a.total), 0) / submitted : null;
          return (
            <Pressable key={q.id} onPress={() => router.push(`/instructor/quiz/${q.id}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <Card style={{ gap: 10 }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <H2>{q.title}</H2>
                    <Caption>
                      {q.class ? `${q.class.code} · ${q.class.section}` : ''} · Due {fmtDate(q.due_at)}
                    </Caption>
                  </View>
                  <QuizStatusPill status={q.status} kind={q.kind} />
                </Row>
                <ProgressBar value={q.enrolled ? submitted / q.enrolled : 0} tone="green" />
                <Row style={{ justifyContent: 'space-between' }}>
                  <Caption>
                    {submitted} of {q.enrolled} submitted
                  </Caption>
                  <Caption style={{ fontWeight: '800', color: colors.primary }}>{avg != null ? `Avg ${Math.round(avg)}%` : 'No scores yet'}</Caption>
                  {q.attempts.some((x) => x.needs_grading) ? <Pill label={`${q.attempts.filter((x) => x.needs_grading).length} to grade`} tone="gold" /> : null}
                </Row>
              </Card>
            </Pressable>
          );
        })}
      </Screen>
    </SafeAreaView>
  );
}
