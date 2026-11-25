import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { NumberField } from '@/components/pickers';
import { Body, Button, Caption, Card, Empty, Field, H1, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { fetchAttemptForGrading, gradeAttempt, typeLabel, type GradingQuestion, type ItemScore, type Response } from '@/lib/data';
import { fmtDateTime, pct } from '@/lib/format';

type Loaded = NonNullable<Awaited<ReturnType<typeof fetchAttemptForGrading>>>;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** What the student answered, as text. */
function given(q: GradingQuestion, r: Response | undefined): string {
  const x = (r ?? {}) as { choice?: number; value?: boolean; correction?: string; text?: string; items?: string[] };
  switch (q.type ?? 'multiple_choice') {
    case 'multiple_choice':
      return x.choice != null && x.choice >= 0 ? `${LETTERS[x.choice]}. ${q.choices[x.choice] ?? ''}` : 'No answer';
    case 'true_false':
      return typeof x.value === 'boolean' ? (x.value ? 'True' : 'False') : 'No answer';
    case 'modified_true_false':
      return typeof x.value === 'boolean' ? (x.value ? 'True' : `False → “${x.correction || '…'}”`) : 'No answer';
    case 'enumeration':
      return x.items?.length ? x.items.join(', ') : 'No answer';
    default:
      return x.text?.trim() ? x.text : 'No answer';
  }
}

/** The answer key, as text. */
function expected(q: GradingQuestion): string {
  const a = q.answer ?? {};
  switch (q.type ?? 'multiple_choice') {
    case 'multiple_choice':
      return q.correct_index != null ? `${LETTERS[q.correct_index]}. ${q.choices[q.correct_index] ?? ''}` : '—';
    case 'true_false':
      return a.value ? 'True' : 'False';
    case 'modified_true_false':
      return a.value ? 'True' : `False → ${(a.accepted ?? []).join(' / ')}`;
    case 'identification':
      return (a.accepted ?? []).join(' / ');
    case 'enumeration':
      return (a.items ?? []).map((alts) => alts.join(' / ')).join(', ');
    default:
      return a.guide ? `Guide: ${a.guide}` : 'Graded by you';
  }
}

export default function GradeAttempt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [essay, setEssay] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAttemptForGrading(id)
      .then((d) => {
        setData(d);
        if (d) {
          setFeedback(d.attempt.feedback ?? '');
          const init: Record<string, number> = {};
          for (const it of d.attempt.item_scores ?? []) {
            const q = d.questions.find((x) => x.id === it.question_id);
            if (q?.type === 'essay') init[q.id] = it.points;
          }
          setEssay(init);
        }
      })
      .catch(() => setData(null));
  }, [id]);

  if (data === undefined) return <Loading />;
  if (!data) return <Screen><Empty icon="cloud-offline-outline" title="Couldn’t load the answers" body="Grading needs an internet connection." /></Screen>;

  const { attempt, quiz, questions } = data;
  const items = attempt.item_scores ?? [];
  const essays = questions.filter((q) => q.type === 'essay');
  const scoreOf = (it: ItemScore | undefined, q: GradingQuestion) => (q.type === 'essay' ? essay[q.id] ?? 0 : it?.points ?? 0);
  const total = items.reduce((n, it) => n + it.max, 0) || attempt.total;
  const score = questions.reduce((n, q) => n + scoreOf(items.find((x) => x.question_id === q.id), q), 0);

  const save = async () => {
    setBusy(true);
    try {
      await gradeAttempt(attempt.id, essay, feedback);
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={essays.length ? <Button title="Save grades" icon="checkmark" onPress={save} loading={busy} /> : <Button title="Done" variant="secondary" onPress={() => router.back()} />}>
      <Stack.Screen options={{ title: attempt.student_name || attempt.student_email }} />
      <View style={{ gap: 4 }}>
        <Caption>
          {quiz?.kind === 'exam' ? 'Exam' : 'Quiz'} · {quiz?.title}
        </Caption>
        <H1>{attempt.student_name || attempt.student_email}</H1>
        <Row>
          {attempt.needs_grading ? <Pill label="Needs grading" tone="gold" /> : <Pill label="Graded" tone="green" />}
          <Caption>Submitted {fmtDateTime(attempt.submitted_at)}</Caption>
        </Row>
      </View>

      <Card tone="primary" style={{ gap: 4 }}>
        <Label style={{ color: colors.gold }}>Score</Label>
        <Text style={styles.big}>
          {score} / {total}
        </Text>
        <Caption style={{ color: colors.onPrimarySoft }}>
          {pct(score, total)}% · passing {quiz?.passing_score ?? 70}%
        </Caption>
      </Card>

      {questions.map((q, i) => {
        const it = items.find((x) => x.question_id === q.id);
        const r = attempt.responses?.[q.position - 1];
        const pts = scoreOf(it, q);
        const max = it?.max ?? q.points ?? 1;
        const full = pts === max;
        return (
          <Card key={q.id} style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.qLabel}>
                {i + 1}. {typeLabel(q.type).toUpperCase()}
              </Text>
              {q.type !== 'essay' ? (
                <Row style={{ gap: 4 }}>
                  <Ionicons name={full ? 'checkmark-circle' : pts > 0 ? 'remove-circle' : 'close-circle'} size={16} color={full ? colors.primary : pts > 0 ? '#B98900' : colors.danger} />
                  <Text style={styles.pts}>
                    {pts}/{max}
                  </Text>
                </Row>
              ) : null}
            </Row>
            <Body style={{ fontWeight: '700' }}>{q.prompt}</Body>
            <View style={styles.answer}>
              <Caption>Student’s answer</Caption>
              <Body>{given(q, r)}</Body>
            </View>
            <Caption>Answer key: {expected(q)}</Caption>
            {q.type === 'essay' ? (
              <NumberField label={`Points (out of ${max})`} value={essay[q.id] ?? 0} onChange={(v) => setEssay((e) => ({ ...e, [q.id]: v }))} step={1} min={0} max={max} />
            ) : null}
          </Card>
        );
      })}

      {essays.length ? (
        <Field label="Feedback to the student (optional)" value={feedback} onChangeText={setFeedback} placeholder="Good examples — explain media queries more." multiline />
      ) : (
        <Caption>Everything in this {quiz?.kind === 'exam' ? 'exam' : 'quiz'} was scored automatically.</Caption>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { color: colors.onPrimary, fontSize: 36, fontWeight: '900' },
  qLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.primary },
  pts: { fontWeight: '800', color: colors.text },
  answer: { backgroundColor: colors.background, borderRadius: radius.md, padding: 12, gap: 2 },
});
