import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ClassPicker, defaultDue, DueDateField, NumberField } from '@/components/pickers';
import { Button, Caption, Card, Empty, Field, Label, Loading, Row, Screen, Segmented } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { fetchQuizForEdit, QUESTION_TYPES, saveQuizOp, type AnswerKey, type AssessmentKind, type DraftQuestion, type QuestionType, type QuizStatus } from '@/lib/data';
import { useOutbox } from '@/lib/outbox';

/** Editor state for one question (all types share it; only the fields of the chosen type are used). */
type Q = {
  key: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: string[];
  correct_index: number;
  truth: boolean | null;
  correction: string;
  accepted: string;
  items: string[];
  guide: string;
};
const LETTERS = ['A', 'B', 'C', 'D'];
const blank = (type: QuestionType = 'multiple_choice'): Q => ({
  key: randomUUID(),
  type,
  prompt: '',
  points: type === 'essay' ? 10 : 1,
  choices: ['', '', '', ''],
  correct_index: 0,
  truth: null,
  correction: '',
  accepted: '',
  items: ['', '', ''],
  guide: '',
});
/** "a / anchor" → ["a", "anchor"] */
const alternatives = (s: string) => s.split('/').map((x) => x.trim()).filter(Boolean);

const PROMPT_HINT: Record<QuestionType, string> = {
  multiple_choice: 'What does HTML stand for?',
  true_false: 'CSS is used to style web pages.',
  modified_true_false: 'The <img> tag creates a hyperlink.',
  identification: 'What language adds interactivity to web pages?',
  enumeration: 'Give the three layers of a web page.',
  essay: 'Explain responsive web design in your own words.',
};

/** Builds the answer key the server expects, or returns why the question isn't ready. */
function toDraft(q: Q, n: number): DraftQuestion | string {
  const base = { type: q.type, prompt: q.prompt.trim(), choices: [] as string[], points: q.points, correct_index: 0, answer: {} as AnswerKey };
  switch (q.type) {
    case 'multiple_choice': {
      const kept = q.choices.map((c, idx) => ({ c: c.trim(), idx })).filter((x) => x.c);
      if (kept.length < 2 || !q.choices[q.correct_index]?.trim()) return `Question ${n}: add at least two choices and mark the correct one.`;
      return { ...base, choices: kept.map((x) => x.c), correct_index: kept.findIndex((x) => x.idx === q.correct_index) };
    }
    case 'true_false':
      if (q.truth == null) return `Question ${n}: mark whether the statement is True or False.`;
      return { ...base, answer: { value: q.truth } };
    case 'modified_true_false':
      if (q.truth == null) return `Question ${n}: mark whether the statement is True or False.`;
      if (!q.truth && !alternatives(q.correction).length) return `Question ${n}: give the word that makes the statement true.`;
      return { ...base, answer: { value: q.truth, accepted: q.truth ? [] : alternatives(q.correction) } };
    case 'identification':
      if (!alternatives(q.accepted).length) return `Question ${n}: give the correct answer.`;
      return { ...base, answer: { accepted: alternatives(q.accepted) } };
    case 'enumeration': {
      const items = q.items.map(alternatives).filter((a) => a.length);
      if (!items.length) return `Question ${n}: list the expected items.`;
      return { ...base, points: items.length, answer: { items } };
    }
    case 'essay':
      return { ...base, answer: { guide: q.guide.trim() } };
  }
}

export default function CreateQuiz() {
  const params = useLocalSearchParams<{ classId?: string; id?: string }>();
  const editing = Boolean(params.id);
  const { data: classes } = useClasses();
  const { save } = useOutbox();
  const [quizId] = useState(() => params.id ?? randomUUID());
  const [kind, setKind] = useState<AssessmentKind>('quiz');
  const [classId, setClassId] = useState<string | null>(params.classId ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState(defaultDue(7));
  const [timeLimit, setTimeLimit] = useState(30);
  const [passing, setPassing] = useState(70);
  const [questions, setQuestions] = useState<Q[]>([blank()]);
  const [loadingEdit, setLoadingEdit] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<QuizStatus | null>(null);

  useEffect(() => {
    if (!params.id) return;
    fetchQuizForEdit(params.id)
      .then(({ quiz, questions: qs }) => {
        if (!quiz) return;
        setKind(quiz.kind ?? 'quiz');
        setClassId(quiz.class_id);
        setTitle(quiz.title);
        setDescription(quiz.description);
        if (quiz.due_at) setDue(quiz.due_at);
        setTimeLimit(quiz.time_limit_minutes);
        setPassing(quiz.passing_score);
        if (qs.length)
          setQuestions(
            qs.map((q) => {
              const a: AnswerKey = q.answer ?? {};
              return {
                ...blank(q.type ?? 'multiple_choice'),
                key: q.id,
                prompt: q.prompt,
                points: q.points ?? 1,
                choices: [...q.choices, '', '', '', ''].slice(0, 4),
                correct_index: q.correct_index ?? 0,
                truth: typeof a.value === 'boolean' ? a.value : null,
                correction: q.type === 'modified_true_false' ? (a.accepted ?? []).join(' / ') : '',
                accepted: q.type === 'identification' ? (a.accepted ?? []).join(' / ') : '',
                items: q.type === 'enumeration' ? (a.items ?? []).map((alts) => alts.join(' / ')) : ['', '', ''],
                guide: a.guide ?? '',
              };
            }),
          );
      })
      .catch(() => setError('You need to be online to edit an existing quiz.'))
      .finally(() => setLoadingEdit(false));
  }, [params.id]);

  useEffect(() => {
    if (!classId && classes?.length === 1 && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const update = (i: number, patch: Partial<Q>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const noun = kind === 'exam' ? 'exam' : 'quiz';
  const totalPoints = questions.reduce((n, q) => n + (q.type === 'enumeration' ? q.items.filter((x) => alternatives(x).length).length : q.points), 0);

  const submit = async (status: QuizStatus) => {
    if (!classId) return setError(`Choose the class for this ${noun}.`);
    if (!title.trim()) return setError(`Give the ${noun} a title.`);
    const filled = questions.filter((q) => q.prompt.trim());
    if (!filled.length) return setError('Add at least one question.');
    const drafts: DraftQuestion[] = [];
    for (const [i, q] of filled.entries()) {
      const d = toDraft(q, i + 1);
      if (typeof d === 'string') return setError(d);
      drafts.push(d);
    }
    setError(null);
    setBusy(status);
    const o = saveQuizOp({ id: quizId, kind, class_id: classId, title, description, due_at: due, time_limit_minutes: timeLimit, passing_score: passing, status, questions: drafts });
    await save(o.op, o.label);
    setBusy(null);
    router.back();
  };

  if (loadingEdit) return <Loading />;
  if (classes && classes.length === 0) {
    return (
      <Screen>
        <Empty icon="people-outline" title="No classes yet" body="Quizzes and exams belong to a class. Your classes appear once the administrator schedules a subject for you." />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Row>
          <Button title="Save draft" variant="secondary" style={{ flex: 1 }} loading={busy === 'draft'} onPress={() => submit('draft')} />
          <Button title={`Publish ${noun}`} style={{ flex: 1 }} loading={busy === 'published'} onPress={() => submit('published')} />
        </Row>
      }>
      <Stack.Screen options={{ title: editing ? `Edit ${noun}` : `Create ${noun}` }} />
      <Segmented
        options={[
          { label: 'Quiz', value: 'quiz' },
          { label: 'Exam', value: 'exam' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Caption>Published {noun === 'exam' ? 'exams' : 'quizzes'} appear to enrolled students right away. Essays are graded by you after students submit.</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Field label={kind === 'exam' ? 'Exam title' : 'Quiz title'} value={title} onChangeText={setTitle} placeholder={kind === 'exam' ? 'Midterm Examination' : 'HTML Basics'} />
      <Field label="Instructions" value={description} onChangeText={setDescription} placeholder="Read each item carefully." multiline />
      <DueDateField value={due} onChange={setDue} />
      <Row style={{ gap: 10 }}>
        <NumberField label="Time limit" value={timeLimit} onChange={setTimeLimit} step={5} min={5} max={240} suffix=" min" />
        <NumberField label="Passing score" value={passing} onChange={setPassing} step={5} min={0} max={100} suffix="%" />
      </Row>

      <Label>
        Questions ({questions.length}) · {totalPoints} point{totalPoints === 1 ? '' : 's'}
      </Label>
      {questions.map((q, i) => (
        <Card key={q.key} style={{ gap: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.qLabel}>
              QUESTION {i + 1} · {QUESTION_TYPES.find((t) => t.type === q.type)?.label.toUpperCase()}
            </Text>
            {questions.length > 1 ? (
              <Pressable onPress={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`Remove question ${i + 1}`}>
                <Ionicons name="trash-outline" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </Row>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {QUESTION_TYPES.map((t) => {
              const on = q.type === t.type;
              return (
                <Pressable
                  key={t.type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => update(i, { type: t.type, points: t.type === 'essay' && q.points < 5 ? 10 : t.type !== 'essay' && q.type === 'essay' ? 1 : q.points })}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && { color: colors.onPrimary }]}>{t.short}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            value={q.prompt}
            onChangeText={(t) => update(i, { prompt: t })}
            placeholder={PROMPT_HINT[q.type]}
            placeholderTextColor={colors.muted}
            multiline
            style={styles.prompt}
          />

          {q.type === 'multiple_choice' ? (
            <>
              {q.choices.map((c, ci) => {
                const correct = q.correct_index === ci;
                return (
                  <View key={ci} style={[styles.choice, correct && styles.choiceCorrect]}>
                    <Pressable onPress={() => update(i, { correct_index: ci })} accessibilityLabel={`Mark ${LETTERS[ci]} as correct`} hitSlop={6} style={[styles.letter, correct && styles.letterCorrect]}>
                      <Text style={[styles.letterText, correct && { color: colors.onPrimary }]}>{LETTERS[ci]}</Text>
                    </Pressable>
                    <TextInput
                      value={c}
                      onChangeText={(t) => update(i, { choices: q.choices.map((x, xi) => (xi === ci ? t : x)) })}
                      placeholder={`Choice ${LETTERS[ci]}`}
                      placeholderTextColor={colors.muted}
                      style={styles.choiceInput}
                    />
                    {correct ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                  </View>
                );
              })}
              <Caption>Tap a letter to mark the correct answer.</Caption>
            </>
          ) : null}

          {q.type === 'true_false' || q.type === 'modified_true_false' ? (
            <>
              <Text style={styles.small}>Correct answer</Text>
              <Row style={{ gap: 10 }}>
                {[true, false].map((v) => {
                  const on = q.truth === v;
                  return (
                    <Pressable key={String(v)} onPress={() => update(i, { truth: v })} style={[styles.tf, on && styles.choiceCorrect]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                      <Ionicons name={v ? 'checkmark-circle' : 'close-circle'} size={20} color={on ? colors.primary : colors.muted} />
                      <Text style={[styles.tfText, on && { color: colors.primary }]}>{v ? 'True' : 'False'}</Text>
                    </Pressable>
                  );
                })}
              </Row>
              {q.type === 'modified_true_false' ? (
                q.truth === false ? (
                  <Field
                    label="Word that makes the statement true"
                    value={q.correction}
                    onChangeText={(t) => update(i, { correction: t })}
                    placeholder="e.g. <a> / anchor"
                    hint="Students who answer False must write this. Separate other accepted words with /."
                  />
                ) : (
                  <Caption>If the statement is False, students must also write the word that makes it true.</Caption>
                )
              ) : null}
            </>
          ) : null}

          {q.type === 'identification' ? (
            <Field
              label="Correct answer"
              value={q.accepted}
              onChangeText={(t) => update(i, { accepted: t })}
              placeholder="e.g. JavaScript / JS"
              hint="Separate other accepted answers with /. Capital letters and extra spaces don’t matter."
            />
          ) : null}

          {q.type === 'enumeration' ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.small}>Expected items (any order · 1 point each)</Text>
              {q.items.map((it, ii) => (
                <Row key={ii} style={{ gap: 8 }}>
                  <Text style={styles.num}>{ii + 1}.</Text>
                  <TextInput
                    value={it}
                    onChangeText={(t) => update(i, { items: q.items.map((x, xi) => (xi === ii ? t : x)) })}
                    placeholder={ii === 0 ? 'e.g. HTML' : ii === 2 ? 'e.g. JavaScript / JS' : 'Item'}
                    placeholderTextColor={colors.muted}
                    style={[styles.choiceInput, styles.itemInput]}
                  />
                  {q.items.length > 1 ? (
                    <Pressable onPress={() => update(i, { items: q.items.filter((_, xi) => xi !== ii) })} hitSlop={8} accessibilityLabel={`Remove item ${ii + 1}`}>
                      <Ionicons name="remove-circle-outline" size={20} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </Row>
              ))}
              <Button title="Add item" icon="add" variant="ghost" small onPress={() => update(i, { items: [...q.items, ''] })} />
              <Caption>Separate other accepted spellings with /. Students get as many blanks as there are items.</Caption>
            </View>
          ) : null}

          {q.type === 'essay' ? (
            <Field
              label="Grading guide (only you see this)"
              value={q.guide}
              onChangeText={(t) => update(i, { guide: t })}
              placeholder="Key points a complete answer mentions."
              multiline
            />
          ) : null}

          {q.type !== 'enumeration' ? (
            <NumberField label="Points" value={q.points} onChange={(v) => update(i, { points: v })} step={1} min={1} max={100} />
          ) : (
            <Caption>Worth {q.items.filter((x) => alternatives(x).length).length} point(s) — one per item.</Caption>
          )}
        </Card>
      ))}
      <Button title="Add question" icon="add" variant="secondary" onPress={() => setQuestions((qs) => [...qs, blank(qs[qs.length - 1]?.type)])} />
      <Caption>New questions use the same type as the last one; change it with the chips above each question.</Caption>
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.primary, flex: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  prompt: { fontSize: 16, fontWeight: '700', color: colors.text, minHeight: 44, borderBottomWidth: 1.5, borderBottomColor: colors.line, paddingVertical: 6 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  choiceCorrect: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  letter: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: colors.mint, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  letterCorrect: { backgroundColor: colors.primary, borderColor: colors.primary },
  letterText: { fontWeight: '800', color: colors.text },
  choiceInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  itemInput: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 10 },
  num: { width: 22, fontWeight: '800', color: colors.textSoft },
  small: { fontSize: 13, fontWeight: '700', color: colors.text },
  tf: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12 },
  tfText: { fontWeight: '800', fontSize: 15, color: colors.text },
});
