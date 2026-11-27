import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Caption, Card, Empty, Loading, Row, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchQuizToTake, typeLabel } from '@/lib/data';
import { pct } from '@/lib/format';
import { cacheGet } from '@/lib/offline';

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }}>
      <Caption>{label}</Caption>
      <Body style={{ fontWeight: '800' }}>{value}</Body>
    </Row>
  );
}

export default function QuizResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useRemote(`quiz-take:${id}`, () => fetchQuizToTake(id));
  const [pending, setPending] = useState<{ answers: number[] } | null>(null);

  useEffect(() => {
    cacheGet<{ answers: number[] }>(`attempt-pending:${id}`).then((c) => setPending(c?.value ?? null));
  }, [id]);

  const done = () => router.dismissTo('/student');

  if (loading && !data) return <Loading />;
  const quiz = data?.quiz;
  const attempt = data?.attempt;

  if (!attempt) {
    if (pending) {
      return (
        <Screen footer={<Button title="Back to Dashboard" onPress={done} />}>
          <Empty icon="cloud-upload-outline" title="Answers saved on your phone" body="You’re offline. Your answers will be sent automatically when you’re back online, then your score appears here." />
        </Screen>
      );
    }
    return (
      <Screen footer={<Button title="Back to Dashboard" onPress={done} />}>
        <Empty icon="alert-circle-outline" title="No result yet" body="Pull down to refresh, or take the quiz first." />
      </Screen>
    );
  }

  const p = pct(attempt.score, attempt.total);
  const passed = p >= (quiz?.passing_score ?? 70);
  const waiting = !!attempt.needs_grading;
  const noun = quiz?.kind === 'exam' ? 'EXAM' : 'QUIZ';
  const questions = data?.questions ?? [];
  const items = attempt.item_scores ?? [];
  const minutes = attempt.started_at ? Math.max(1, Math.round((new Date(attempt.submitted_at).getTime() - new Date(attempt.started_at).getTime()) / 60000)) : null;

  return (
    <Screen footer={<Button title="Back to Dashboard" onPress={done} />}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{noun} SUBMITTED!</Text>
        <View style={[styles.ring, { borderColor: waiting ? colors.mint : passed ? colors.gold : colors.dangerSoft }]}>
          <Text style={styles.pct}>{waiting ? '…' : `${p}%`}</Text>
          <Text style={styles.ringSub}>{waiting ? 'Being graded' : 'You scored'}</Text>
        </View>
        <Text style={styles.title}>{waiting ? 'Almost done!' : passed ? 'Great job!' : 'Keep practicing!'}</Text>
        <Text style={styles.sub}>
          {waiting
            ? `${attempt.score} of ${attempt.total} points so far — your instructor still has to grade your essay.`
            : `You scored ${attempt.score} out of ${attempt.total} points.`}
        </Text>
      </View>
      <Card>
        <Line label="Questions" value={String(questions.length || items.length)} />
        <Line label="Your points" value={`${attempt.score} / ${attempt.total}${waiting ? ' (so far)' : ''}`} />
        <Line label="Time taken" value={minutes ? `${minutes} min` : '—'} />
      </Card>
      {items.length && questions.length ? (
        <Card style={{ gap: 2 }}>
          {questions.map((q, i) => {
            const it = items.find((x) => x.question_id === q.id);
            if (!it) return null;
            const full = !it.pending && it.points === it.max;
            return (
              <Row key={q.id} style={{ paddingVertical: 8, borderBottomWidth: i === questions.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.line }}>
                <Ionicons
                  name={it.pending ? 'time-outline' : full ? 'checkmark-circle' : it.points > 0 ? 'remove-circle' : 'close-circle'}
                  size={18}
                  color={it.pending ? colors.textSoft : full ? colors.primary : it.points > 0 ? colors.partial : colors.danger}
                />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>
                    {i + 1}. {q.prompt}
                  </Body>
                  <Caption>{typeLabel(q.type)}</Caption>
                </View>
                <Caption style={{ fontWeight: '800', color: colors.text }}>{it.pending ? 'To grade' : `${it.points}/${it.max}`}</Caption>
              </Row>
            );
          })}
        </Card>
      ) : null}
      {attempt.feedback ? (
        <Card tone="gold" style={{ gap: 4 }}>
          <Caption style={{ fontWeight: '800', color: colors.text }}>Feedback from your instructor</Caption>
          <Body>{attempt.feedback}</Body>
        </Card>
      ) : null}
      {waiting ? null : (
      <Card tone={passed ? 'soft' : 'plain'}>
        <Row>
          <Ionicons name={passed ? 'ribbon' : 'refresh-circle'} size={22} color={passed ? colors.primary : colors.danger} />
          <Caption style={{ flex: 1, color: colors.text, fontWeight: '700' }}>
            {passed ? `Passed · ${quiz?.passing_score ?? 70}% required. You’re ready for the next lesson.` : `Not passed · ${quiz?.passing_score ?? 70}% required. Review the lesson with your instructor.`}
          </Caption>
        </Row>
      </Card>
      )}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 24, alignItems: 'center', gap: 10 },
  kicker: { color: colors.gold, fontWeight: '800', letterSpacing: 1.4, fontSize: 12 },
  ring: { width: 150, height: 150, borderRadius: 75, borderWidth: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  pct: { fontSize: 40, fontWeight: '900', color: colors.primary },
  ringSub: { fontSize: 12, color: colors.textSoft, fontWeight: '700' },
  title: { color: colors.onPrimary, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.onPrimarySoft, fontSize: 15 },
}));
