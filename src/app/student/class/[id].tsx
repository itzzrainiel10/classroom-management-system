import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Body, Caption, Card, Empty, H1, H2, Label, ListCard, ListItem, Loading, OfflineNote, Pill, Screen, Segmented } from '@/components/ui';
import { useStudentHome } from '@/hooks/use-student';
import { fmtDate, fmtDateTime } from '@/lib/format';

export default function StudentClass() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, offline, savedAt, refresh } = useStudentHome();
  const [tab, setTab] = useState<'activities' | 'announcements'>('activities');
  if (loading && !data) return <Loading />;
  const cls = data?.classes.find((c) => c.id === id);
  if (!data || !cls) return <Screen><Empty icon="book-outline" title="Class not found" body="Pull down to refresh." /></Screen>;
  const quizzes = data.quizzes.filter((q) => q.class_id === id);
  const assignments = data.feed.assignments.filter((a) => a.class_id === id);
  const announcements = data.feed.announcements.filter((a) => a.class_id === id);

  return (
    <Screen onRefresh={refresh}>
      <Stack.Screen options={{ title: cls.code }} />
      <OfflineNote show={offline} savedAt={savedAt} />
      <View style={{ gap: 4 }}>
        <H1>{cls.code}</H1>
        <Caption>
          {cls.title} · Section {cls.section}
        </Caption>
      </View>
      <Segmented
        options={[
          { label: 'Activities', value: 'activities' as const },
          { label: 'Announcements', value: 'announcements' as const },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'activities' ? (
        <>
          <Label>Quizzes</Label>
          {quizzes.length ? (
            <ListCard>
              {quizzes.map((q, i) => (
                <ListItem
                  key={q.id}
                  icon="create-outline"
                  title={q.title}
                  subtitle={`${q.questions} questions · ${q.time_limit_minutes} minutes · Due ${fmtDate(q.due_at)}`}
                  right={q.attempts.length ? <Pill label="Done" tone="green" /> : <Pill label="Available" tone="gold" />}
                  last={i === quizzes.length - 1}
                  onPress={() => router.push(q.attempts.length ? `/student/quiz/result/${q.id}` : `/student/quiz/${q.id}`)}
                />
              ))}
            </ListCard>
          ) : (
            <Caption>No quizzes yet.</Caption>
          )}
          <Label>Assignments</Label>
          {assignments.length ? (
            assignments.map((a) => (
              <Card key={a.id} style={{ gap: 4 }}>
                <Label>To do · Due {fmtDate(a.due_at)}</Label>
                <H2>{a.title}</H2>
                {a.description ? <Body>{a.description}</Body> : null}
                <Caption>Due {fmtDateTime(a.due_at)}</Caption>
              </Card>
            ))
          ) : (
            <Caption>No assignments yet.</Caption>
          )}
        </>
      ) : announcements.length ? (
        announcements.map((a) => (
          <Card key={a.id} style={{ gap: 4 }}>
            <Label>Class update</Label>
            <H2>{a.title}</H2>
            <Body>{a.message}</Body>
            <Caption>Instructor · {fmtDate(a.created_at)}</Caption>
          </Card>
        ))
      ) : (
        <Caption>No announcements yet.</Caption>
      )}
    </Screen>
  );
}
