import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Block, Figures, scheduleLine, styles } from '@/components/semester';
import { Caption, Card, Empty, H2, Loading, OfflineNote, Pill, Screen, Segmented } from '@/components/ui';
import { useRemote } from '@/hooks/use-remote';
import { fetchInstructorClassRecord, pctOf } from '@/lib/archive';
import { fmtDate } from '@/lib/format';

type Tab = 'students' | 'grades' | 'attendance' | 'posts';

/** A class from an ended semester, exactly as it was archived. Everything is read-only. */
export default function ArchivedClass() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rec, loading, offline, savedAt, refresh } = useRemote(`archive-class-${id}`, () => fetchInstructorClassRecord(id));
  const [tab, setTab] = useState<Tab>('students');

  if (loading && !rec) return <Loading />;
  if (!rec?.data) {
    return (
      <Screen>
        <Empty icon="archive-outline" title="Class not found" body="This archived class isn’t available." />
      </Screen>
    );
  }
  const d = rec.data;
  const attempts = d.quizzes.flatMap((q) => q.attempts);
  const scores = attempts.map(pctOf).filter((x): x is number => x != null);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const records = d.attendance.flatMap((s) => s.records);
  const rate = records.length ? Math.round((records.filter((r) => r.status === 'present').length / records.length) * 100) : null;

  return (
    <Screen onRefresh={refresh}>
      <Stack.Screen options={{ title: `${rec.code} · ${rec.section}` }} />
      <OfflineNote show={offline} savedAt={savedAt} />
      <Card tone="soft" style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <H2 style={{ flex: 1 }}>{rec.title}</H2>
          <Pill label="Read-only" tone="muted" />
        </View>
        <Caption>
          {rec.code} · {rec.section}
          {d.subject?.units ? ` · ${d.subject.units} units` : ''}
        </Caption>
        {d.schedule.map((s, i) => (
          <Caption key={i}>{scheduleLine(s)}</Caption>
        ))}
        <Figures
          items={[
            ['Students', String(d.students.length)],
            ['Average score', avg == null ? '—' : `${avg}%`],
            ['Attendance', rate == null ? '—' : `${rate}%`],
          ]}
        />
      </Card>

      <Segmented<Tab>
        options={[
          { label: 'Students', value: 'students' },
          { label: 'Grades', value: 'grades' },
          { label: 'Attendance', value: 'attendance' },
          { label: 'Posts', value: 'posts' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'students' ? (
        <Card style={{ gap: 10 }}>
          {d.students.length ? (
            d.students.map((s) => {
              const mine = attempts.filter((a) => a.student_email?.toLowerCase() === s.email);
              const ps = mine.map(pctOf).filter((x): x is number => x != null);
              const sAvg = ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
              const att = records.filter((r) => r.student_email?.toLowerCase() === s.email);
              const pres = att.filter((r) => r.status === 'present').length;
              return (
                <View key={s.email} style={styles.line}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={styles.lineTitle}>{s.full_name || s.email}</Text>
                    <Caption>{[s.student_number, s.email].filter(Boolean).join(' · ')}</Caption>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Caption>Avg {sAvg == null ? '—' : `${sAvg}%`}</Caption>
                    <Caption>{att.length ? `Present ${pres}/${att.length}` : 'No attendance'}</Caption>
                  </View>
                </View>
              );
            })
          ) : (
            <Caption>No students were enrolled.</Caption>
          )}
        </Card>
      ) : null}

      {tab === 'grades' ? (
        d.quizzes.length ? (
          d.quizzes.map((q) => (
            <Card key={q.id} style={{ gap: 8 }}>
              <View style={styles.line}>
                <H2 style={{ flex: 1 }}>{q.title}</H2>
                <Pill label={q.status === 'published' ? q.kind || 'Quiz' : 'Draft'} tone={q.status === 'published' ? 'green' : 'muted'} />
              </View>
              <Caption>
                Due {fmtDate(q.due_at)} · passing {q.passing_score ?? 0}% · {q.attempts.length} submission{q.attempts.length === 1 ? '' : 's'}
              </Caption>
              {q.attempts.map((a) => {
                const p = pctOf(a);
                return (
                  <View key={a.student_email} style={[styles.line, { paddingTop: 6 }]}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.lineTitle}>{a.student_name || a.student_email}</Text>
                      {a.feedback ? <Text style={styles.feedback}>“{a.feedback}”</Text> : null}
                    </View>
                    {a.needs_grading ? (
                      <Pill label="Not graded" tone="gold" />
                    ) : (
                      <Pill label={`${a.score ?? 0}/${a.total ?? 0}${p != null ? ` · ${p}%` : ''} · ${p != null && p >= (q.passing_score ?? 0) ? 'Passed' : 'Failed'}`} tone={p != null && p >= (q.passing_score ?? 0) ? 'green' : 'red'} />
                    )}
                  </View>
                );
              })}
            </Card>
          ))
        ) : (
          <Empty icon="document-text-outline" title="No quizzes or exams" body="This class had no assessments." />
        )
      ) : null}

      {tab === 'attendance' ? (
        d.attendance.length ? (
          d.attendance.map((s) => {
            const pres = s.records.filter((r) => r.status === 'present');
            const abs = s.records.filter((r) => r.status !== 'present');
            return (
              <Card key={s.id} style={{ gap: 6 }}>
                <View style={styles.line}>
                  <H2 style={{ flex: 1 }}>{fmtDate(s.session_date)}</H2>
                  <Pill label={`${pres.length} present`} tone="green" />
                  {abs.length ? <Pill label={`${abs.length} absent`} tone="red" /> : null}
                </View>
                {abs.length ? <Caption>Absent: {abs.map((r) => r.student_name || r.student_email).join(', ')}</Caption> : null}
              </Card>
            );
          })
        ) : (
          <Empty icon="checkbox-outline" title="No attendance" body="No meetings were recorded for this class." />
        )
      ) : null}

      {tab === 'posts' ? (
        <>
          <Card style={{ gap: 8 }}>
            <Block title={`Assignments (${d.assignments.length})`}>
              {d.assignments.length ? (
                d.assignments.map((x) => (
                  <View key={x.id} style={styles.line}>
                    <Text style={[styles.lineTitle, { flex: 1 }]}>{x.title}</Text>
                    <Caption>Due {fmtDate(x.due_at)}</Caption>
                  </View>
                ))
              ) : (
                <Caption>None.</Caption>
              )}
            </Block>
          </Card>
          <Card style={{ gap: 8 }}>
            <Block title={`Announcements (${d.announcements.length})`}>
              {d.announcements.length ? (
                d.announcements.map((x) => (
                  <View key={x.id} style={{ gap: 2 }}>
                    <Text style={styles.lineTitle}>{x.title}</Text>
                    {x.message ? <Caption>{x.message}</Caption> : null}
                    <Caption>{fmtDate(x.created_at)}</Caption>
                  </View>
                ))
              ) : (
                <Caption>None.</Caption>
              )}
            </Block>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
