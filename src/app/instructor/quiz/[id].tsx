import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Share, View } from 'react-native';

import { Button, Caption, Card, Empty, H1, Label, ListCard, ListItem, Loading, OfflineNote, Pill, QuizStatusPill, ProgressBar, Row, Screen, Stat } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchQuizResults, saveQuizOp, deleteOp, fetchQuizForEdit } from '@/lib/data';
import { fmtDateTime, pct } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';

export default function QuizResults() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { save } = useOutbox();
  const { data, loading, offline, savedAt, refresh } = useRemote(`quiz-results:${id}`, () => fetchQuizResults(id));

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Screen>
        <OfflineNote show={offline} savedAt={savedAt} />
        <Empty icon="alert-circle-outline" title="Quiz not found" body="It may still be uploading. Pull down to refresh once you’re online." />
      </Screen>
    );
  }

  const { quiz, roster } = data;
  const attempts = [...quiz.attempts].sort((a, b) => b.score / (b.total || 1) - a.score / (a.total || 1));
  const submittedEmails = new Set(attempts.map((a) => a.student_email));
  const pendingStudents = roster.filter((s) => !submittedEmails.has(s.email));
  const scores = attempts.map((a) => pct(a.score, a.total));
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
  const highest = scores.length ? Math.max(...scores) : null;
  const passed = scores.filter((s) => s >= quiz.passing_score).length;

  const report = async () => {
    const lines = [
      `${quiz.title} — ${quiz.class?.code ?? ''} · ${quiz.class?.section ?? ''}`,
      `Submitted ${attempts.length} of ${roster.length} · Class average ${avg ?? 0}% · Passing ${quiz.passing_score}%`,
      '',
      'Student,Email,Score,Total,Percent,Status',
      ...attempts.map((a) => `"${a.student_name || a.student_email}",${a.student_email},${a.score},${a.total},${pct(a.score, a.total)}%,${pct(a.score, a.total) >= quiz.passing_score ? 'Passed' : 'Failed'}`),
      ...pendingStudents.map((s) => `"${s.full_name || s.email}",${s.email},,,,Pending`),
    ];
    await Share.share({ title: `${quiz.title} report`, message: lines.join('\n') });
  };

  const togglePublish = async () => {
    try {
      const full = await fetchQuizForEdit(quiz.id);
      if (!full.quiz) return;
      const o = saveQuizOp({
        ...full.quiz,
        status: quiz.status === 'published' ? 'draft' : 'published',
        kind: full.quiz.kind ?? 'quiz',
        questions: full.questions.map((q) => ({
          type: q.type ?? 'multiple_choice',
          prompt: q.prompt,
          choices: q.choices,
          points: q.points ?? 1,
          correct_index: q.correct_index ?? 0,
          answer: q.answer ?? {},
        })),
      });
      await save(o.op, o.label);
      refresh();
    } catch {
      Alert.alert('You’re offline', 'Connect to the internet to change the quiz status.');
    }
  };

  const remove = () =>
    Alert.alert('Delete this quiz?', 'All student answers for it will be deleted too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const o = deleteOp('quizzes', quiz.id, `Delete quiz ${quiz.title}`); await save(o.op, o.label); router.back(); } },
    ]);

  return (
    <Screen onRefresh={refresh}>
      <Stack.Screen options={{ title: quiz.title }} />
      <OfflineNote show={offline} savedAt={savedAt} />
      <View style={{ gap: 4 }}>
        <Caption>
          {quiz.class?.code} · {quiz.class?.title}
        </Caption>
        <H1>{quiz.title}</H1>
        <Row>
          <QuizStatusPill status={quiz.status} kind={quiz.kind} />
          <Caption>Due {fmtDateTime(quiz.due_at)}</Caption>
        </Row>
      </View>

      {attempts.some((a) => a.needs_grading) ? (
        <Card tone="gold" style={{ gap: 4 }}>
          <Label style={{ color: colors.text }}>Essays to grade</Label>
          <Caption style={{ color: colors.text }}>
            {attempts.filter((a) => a.needs_grading).length} submission(s) have essay answers waiting for your points. Tap a student marked “Needs grading”.
          </Caption>
        </Card>
      ) : null}

      <Card tone="primary" style={{ gap: 10 }}>
        <Label style={{ color: colors.gold }}>Class average</Label>
        <Row style={{ alignItems: 'flex-end' }}>
          <Caption style={{ fontSize: 44, fontWeight: '800', color: colors.onPrimary, lineHeight: 50 }}>{avg != null ? `${avg}%` : '—'}</Caption>
          <Caption style={{ color: colors.onPrimarySoft, marginBottom: 8 }}>Based on {attempts.length} submitted quizzes</Caption>
        </Row>
        <ProgressBar value={roster.length ? attempts.length / roster.length : 0} />
        <Caption style={{ color: colors.onPrimarySoft }}>
          {attempts.length} of {roster.length} submitted
        </Caption>
      </Card>

      <Row style={{ gap: 10 }}>
        <Stat label="Submitted" value={String(attempts.length)} />
        <Stat label="Pending" value={String(pendingStudents.length)} />
        <Stat label="Highest" value={highest != null ? `${highest}%` : '—'} />
      </Row>

      <Card tone="soft" style={{ gap: 4 }}>
        <Label>Assessment summary</Label>
        <Caption style={{ color: colors.text }}>
          {quiz.questions} questions · {quiz.time_limit_minutes} minutes · Passing score {quiz.passing_score}% · {passed} passed
        </Caption>
      </Card>

      <Label>Student · Score</Label>
      {attempts.length ? (
        <ListCard>
          {attempts.map((a, i) => {
            const p = pct(a.score, a.total);
            return (
              <ListItem
                key={a.id}
                title={a.student_name || a.student_email}
                subtitle={`Submitted ${fmtDateTime(a.submitted_at)}${a.needs_grading ? ' · Needs grading' : a.graded_at ? ' · Graded' : ''}`}
                onPress={() => router.push({ pathname: '/instructor/grade/[id]', params: { id: a.id } })}
                last={i === attempts.length - 1}
                right={
                  <View style={{ alignItems: 'flex-end' }}>
                    {a.needs_grading ? <Pill label="Needs grading" tone="gold" /> : null}
                    <Caption style={{ fontWeight: '800', fontSize: 15, color: a.needs_grading ? colors.textSoft : p >= quiz.passing_score ? colors.primary : colors.danger }}>
                      {a.score} / {a.total}
                    </Caption>
                    <Caption>{p}%</Caption>
                  </View>
                }
              />
            );
          })}
        </ListCard>
      ) : (
        <Caption>No submissions yet.</Caption>
      )}

      {pendingStudents.length ? (
        <>
          <Label>Not yet submitted</Label>
          <ListCard>
            {pendingStudents.map((s, i) => (
              <ListItem key={s.id} title={s.full_name || s.email} last={i === pendingStudents.length - 1} right={<Pill label="Pending" tone="gold" />} />
            ))}
          </ListCard>
        </>
      ) : null}

      <Button title="Download report" icon="download-outline" onPress={report} />
      <Row>
        <Button title="Edit quiz" icon="create-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/instructor/quiz/new', params: { id: quiz.id } })} />
        <Button title={quiz.status === 'published' ? 'Unpublish' : 'Publish'} variant="secondary" style={{ flex: 1 }} onPress={togglePublish} />
      </Row>
      <Button title="Delete quiz" icon="trash-outline" variant="danger" onPress={remove} />
    </Screen>
  );
}
