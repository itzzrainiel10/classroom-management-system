import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Body, Button, Caption, Card, Empty, H1, Label, Loading, OfflineNote, Row, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchQuizToTake } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
      <Caption>{label}</Caption>
      <Body style={{ fontWeight: '700' }}>{value}</Body>
    </Row>
  );
}

export default function QuizIntro() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, offline, savedAt } = useRemote(`quiz-take:${id}`, () => fetchQuizToTake(id));
  if (loading && !data) return <Loading />;
  if (!data?.quiz) return <Screen><Empty icon="alert-circle-outline" title="Quiz not available" body="Ask your instructor if it has been published." /></Screen>;
  const { quiz, questions, attempt } = data;

  return (
    <Screen
      footer={
        attempt ? (
          <Button title="View my results" onPress={() => router.replace(`/student/quiz/result/${id}`)} />
        ) : (
          <Button title="Take Quiz" iconRight="arrow-forward" disabled={!questions.length} onPress={() => router.push(`/student/quiz/take/${id}`)} />
        )
      }>
      <OfflineNote show={offline} savedAt={savedAt} />
      <View style={{ gap: 4 }}>
        <Label>
          {quiz.class?.code} · Section {quiz.class?.section}
        </Label>
        <H1>{quiz.title}</H1>
        {quiz.description ? <Caption>{quiz.description}</Caption> : null}
      </View>
      <Card>
        <Detail label="Questions" value={String(questions.length)} />
        <Detail label="Time limit" value={`${quiz.time_limit_minutes} minutes`} />
        <Detail label="Passing score" value={`${quiz.passing_score}%`} />
        <Detail label="Due date" value={fmtDateTime(quiz.due_at)} />
      </Card>
      <Card tone="soft" style={{ gap: 8 }}>
        <Label>Before you begin</Label>
        {['Make sure you have a stable connection.', 'Your timer starts when you begin the quiz.', 'You can submit only once.'].map((t) => (
          <Row key={t} style={{ gap: 8 }}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Caption style={{ flex: 1, color: colors.text }}>{t}</Caption>
          </Row>
        ))}
        <Caption>If you lose signal, your answers are saved on your phone and sent when you’re back online.</Caption>
      </Card>
    </Screen>
  );
}
