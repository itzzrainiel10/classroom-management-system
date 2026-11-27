import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Pill, Row, Screen, Segmented } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useStudentHome } from '@/hooks/use-student';
import { fmtDate, pct } from '@/lib/format';

export default function StudentQuizzes() {
  const { data, loading, offline, savedAt, refresh } = useStudentHome();
  const [tab, setTab] = useState<'available' | 'completed'>('available');
  const quizzes = data?.quizzes ?? [];
  const available = quizzes.filter((q) => q.attempts.length === 0);
  const completed = quizzes.filter((q) => q.attempts.length > 0);
  const list = tab === 'available' ? available : completed;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Student" title="Quizzes" subtitle="Keep track of your coursework." />
        <OfflineNote show={offline} savedAt={savedAt} />
        <Segmented
          options={[
            { label: `Available (${available.length})`, value: 'available' as const },
            { label: `Completed (${completed.length})`, value: 'completed' as const },
          ]}
          value={tab}
          onChange={setTab}
        />
        {loading && !data ? <Loading /> : null}
        {data && list.length === 0 ? (
          <Empty icon="create-outline" title={tab === 'available' ? 'You’re all caught up' : 'No completed quizzes yet'} body={tab === 'available' ? 'New quizzes from your instructors appear here.' : 'Quizzes you finish show up here with your score.'} />
        ) : null}
        {list.map((q) => {
          const a = q.attempts[0];
          return (
            <Pressable key={q.id} onPress={() => router.push(a ? `/student/quiz/result/${q.id}` : `/student/quiz/${q.id}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <Card style={{ gap: 8 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Label>{a ? 'Completed' : 'Available'}</Label>
                  {a ? (a.needs_grading ? <Pill label="Being graded" tone="gold" /> : <Pill label={`${pct(a.score, a.total)}% · ${pct(a.score, a.total) >= q.passing_score ? 'Passed' : 'Failed'}`} tone={pct(a.score, a.total) >= q.passing_score ? 'green' : 'red'} />) : <Pill label={`Due ${fmtDate(q.due_at)}`} tone="gold" />}
                </Row>
                <View>
                  <H2>{q.title}</H2>
                  <Caption>
                    {q.class?.code} · {q.questions} questions · {q.time_limit_minutes} minutes
                  </Caption>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </Screen>
    </SafeAreaView>
  );
}
