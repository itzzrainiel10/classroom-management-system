import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Caption, Empty, Loading, ProgressBar, Row, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchQuizToTake, submitQuizNow, submitQuizOp, typeLabel, type Question, type Response } from '@/lib/data';
import { mmss } from '@/lib/format';
import { cacheSet } from '@/lib/offline';
import { useOutbox } from '@/lib/outbox';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** One response object per question; empty object = not answered. */
type R = { choice?: number; value?: boolean; correction?: string; text?: string; items?: string[] };

function isAnswered(q: Question, r: R | undefined) {
  if (!r) return false;
  switch (q.type ?? 'multiple_choice') {
    case 'multiple_choice':
      return r.choice != null && r.choice >= 0;
    case 'true_false':
      return typeof r.value === 'boolean';
    case 'modified_true_false':
      return r.value === true || (r.value === false && !!r.correction?.trim());
    case 'enumeration':
      return !!r.items?.some((x) => x.trim());
    default:
      return !!r.text?.trim();
  }
}

const HINT: Record<string, string> = {
  multiple_choice: 'Select one answer.',
  true_false: 'Is the statement True or False?',
  modified_true_false: 'If False, write the word that makes the statement true.',
  identification: 'Type your answer.',
  enumeration: 'Fill in each blank. Order doesn’t matter.',
  essay: 'Write your answer. Your instructor grades this.',
};

export default function TakeQuiz() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useRemote(`quiz-take:${id}`, () => fetchQuizToTake(id));
  const { save } = useOutbox();
  const [startedAt] = useState(() => new Date().toISOString());
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<R[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);

  const quiz = data?.quiz;
  const questions = data?.questions ?? [];
  const noun = quiz?.kind === 'exam' ? 'exam' : 'quiz';

  useEffect(() => {
    if (!quiz) return;
    const end = new Date(startedAt).getTime() + quiz.time_limit_minutes * 60_000;
    const tick = () => setLeft(Math.max(0, (end - Date.now()) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [quiz, startedAt]);

  const set = (patch: R) =>
    setAnswers((a) => {
      const n = [...a];
      n[index] = { ...(n[index] ?? {}), ...patch };
      return n;
    });

  const submit = async () => {
    if (!quiz || submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    // Responses in question order; {} = skipped.
    const payload = questions.map((q, i) => {
      const r = answers[i] ?? {};
      switch (q.type ?? 'multiple_choice') {
        case 'multiple_choice':
          return r.choice != null ? { choice: r.choice } : {};
        case 'true_false':
          return typeof r.value === 'boolean' ? { value: r.value } : {};
        case 'modified_true_false':
          return typeof r.value === 'boolean' ? { value: r.value, correction: (r.correction ?? '').trim() } : {};
        case 'enumeration':
          return { items: (r.items ?? []).map((x) => x.trim()).filter(Boolean) };
        default:
          return { text: (r.text ?? '').trim() };
      }
    }) as Response[];
    try {
      const attempt = await submitQuizNow(quiz.id, payload, startedAt);
      if (!attempt) {
        const o = submitQuizOp(quiz.id, payload, startedAt, quiz.title);
        await cacheSet(`attempt-pending:${quiz.id}`, { answers: payload, startedAt, savedAt: new Date().toISOString() });
        await save(o.op, o.label);
      }
      router.replace(`/student/quiz/result/${quiz.id}`);
    } catch (e) {
      submitted.current = false;
      setSubmitting(false);
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  useEffect(() => {
    if (left === 0) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  if (!data) return <Loading />;
  if (!quiz || !questions.length) return <Screen><Empty icon="alert-circle-outline" title="Not available" body="Open it again while online." /></Screen>;
  if (data.attempt) {
    router.replace(`/student/quiz/result/${quiz.id}`);
    return null;
  }

  const q = questions[index];
  if (!q) return null;
  const type = q.type ?? 'multiple_choice';
  const r = answers[index] ?? {};
  const isLast = index === questions.length - 1;
  const answered = questions.filter((qq, i) => isAnswered(qq, answers[i])).length;

  const exit = () =>
    Alert.alert(`Leave the ${noun}?`, 'Your answers will not be saved and the timer keeps running.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);

  const confirmSubmit = () => {
    const missing = questions.length - answered;
    if (missing > 0)
      Alert.alert(`Submit ${noun}?`, `You left ${missing} question${missing === 1 ? '' : 's'} unanswered.`, [
        { text: 'Keep answering', style: 'cancel' },
        { text: 'Submit', onPress: submit },
      ]);
    else submit();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.top}>
        <Pressable onPress={exit} hitSlop={10} accessibilityLabel={`Leave ${noun}`}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.qTitle} numberOfLines={1}>
            {quiz.class?.code} · {quiz.title}
          </Text>
          <Caption>
            Question {index + 1} of {questions.length} · {Math.round(((index + 1) / questions.length) * 100)}% complete
          </Caption>
        </View>
        <View style={[styles.timer, left != null && left < 60 && { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="time-outline" size={16} color={left != null && left < 60 ? colors.danger : colors.primary} />
          <Text style={[styles.timerText, left != null && left < 60 && { color: colors.danger }]}>{left == null ? '--:--' : mmss(left)}</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <ProgressBar value={(index + 1) / questions.length} />
      </View>
      <Screen
        footer={
          <Row>
            <Button title="Back" variant="secondary" disabled={index === 0} style={{ flex: 1 }} onPress={() => setIndex((i) => i - 1)} />
            {isLast ? (
              <Button title="Submit" icon="checkmark" style={{ flex: 2 }} loading={submitting} onPress={confirmSubmit} />
            ) : (
              <Button title="Next" iconRight="arrow-forward" style={{ flex: 2 }} onPress={() => setIndex((i) => i + 1)} />
            )}
          </Row>
        }>
        <Text style={styles.label}>
          QUESTION {index + 1} · {typeLabel(type).toUpperCase()} · {q.points ?? 1} PT{(q.points ?? 1) === 1 ? '' : 'S'}
        </Text>
        <Text style={styles.prompt}>{q.prompt}</Text>
        <Caption>{HINT[type]}</Caption>

        {type === 'multiple_choice' ? (
          <View style={{ gap: 10 }}>
            {q.choices.map((c, ci) => {
              const picked = r.choice === ci;
              return (
                <Pressable key={ci} accessibilityRole="radio" accessibilityState={{ selected: picked }} onPress={() => set({ choice: ci })} style={[styles.choice, picked && styles.choicePicked]}>
                  <View style={[styles.letter, picked && styles.letterPicked]}>
                    <Text style={[styles.letterText, picked && { color: colors.text }]}>{LETTERS[ci]}</Text>
                  </View>
                  <Text style={[styles.choiceText, picked && { color: colors.onPrimary }]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {type === 'true_false' || type === 'modified_true_false' ? (
          <View style={{ gap: 10 }}>
            <Row style={{ gap: 10 }}>
              {[true, false].map((v) => {
                const picked = r.value === v;
                return (
                  <Pressable key={String(v)} accessibilityRole="radio" accessibilityState={{ selected: picked }} onPress={() => set({ value: v })} style={[styles.tf, picked && styles.choicePicked]}>
                    <Ionicons name={v ? 'checkmark-circle' : 'close-circle'} size={22} color={picked ? colors.gold : colors.primary} />
                    <Text style={[styles.choiceText, { flex: 0 }, picked && { color: colors.onPrimary }]}>{v ? 'True' : 'False'}</Text>
                  </Pressable>
                );
              })}
            </Row>
            {type === 'modified_true_false' && r.value === false ? (
              <TextInput
                value={r.correction ?? ''}
                onChangeText={(t) => set({ correction: t })}
                placeholder="Word that makes it true"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                style={styles.input}
              />
            ) : null}
          </View>
        ) : null}

        {type === 'identification' ? (
          <TextInput value={r.text ?? ''} onChangeText={(t) => set({ text: t })} placeholder="Your answer" placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} />
        ) : null}

        {type === 'enumeration' ? (
          <View style={{ gap: 8 }}>
            {Array.from({ length: q.item_count ?? 1 }, (_, ii) => (
              <Row key={ii} style={{ gap: 10 }}>
                <Text style={styles.num}>{ii + 1}.</Text>
                <TextInput
                  value={r.items?.[ii] ?? ''}
                  onChangeText={(t) => {
                    const items = [...(r.items ?? [])];
                    items[ii] = t;
                    set({ items });
                  }}
                  placeholder={`Item ${ii + 1}`}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  style={[styles.input, { flex: 1 }]}
                />
              </Row>
            ))}
          </View>
        ) : null}

        {type === 'essay' ? (
          <TextInput
            value={r.text ?? ''}
            onChangeText={(t) => set({ text: t })}
            placeholder="Write your answer here…"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.input, { minHeight: 180, textAlignVertical: 'top' }]}
          />
        ) : null}

        <Caption style={{ textAlign: 'center' }}>
          {answered} of {questions.length} answered
        </Caption>
      </Screen>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  qTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  timerText: { fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'] },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.primary },
  prompt: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, lineHeight: 29 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  choicePicked: { backgroundColor: colors.primary, borderColor: colors.primary },
  letter: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  letterPicked: { backgroundColor: colors.gold },
  letterText: { fontWeight: '800', color: colors.primary, fontSize: 15 },
  choiceText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  tf: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  input: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: colors.text },
  num: { width: 24, fontWeight: '800', color: colors.textSoft, fontSize: 15 },
}));
