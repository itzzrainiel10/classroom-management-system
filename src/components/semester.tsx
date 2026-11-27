import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MenuRow } from '@/components/menu-row';
import { Caption, Card, Empty, H2, Label, Loading, OfflineNote, Pill, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import {
  fetchMyInstructorArchive,
  fetchMyStudentArchive,
  fetchSemesters,
  pctOf,
  semesterLabel,
  type ArchivedSchedule,
  type SemesterRef,
  type StudentClassRecord,
} from '@/lib/archive';
import { dayName, fmtDate, fmtTime } from '@/lib/format';

type Role = 'student' | 'instructor';

export const scheduleLine = (s: ArchivedSchedule) =>
  `${dayName(s.day_of_week)} ${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}${s.room ? ` · ${s.room}` : ''}${s.extra ? ' (extra)' : ''}`;

export const datesOf = (s: SemesterRef) => (s.starts_on && s.ends_on ? `${fmtDate(s.starts_on)} – ${fmtDate(s.ends_on)}` : 'Dates not set');

/** Semesters + this person's archived classes, shared by the list and detail screens. */
export function useSemesterArchive(role: Role) {
  const sems = useRemote('semesters', fetchSemesters);
  const recs = useRemote<{ id: string; semester_id: string }[]>(
    role === 'student' ? 'archive-student' : 'archive-instructor',
    role === 'student' ? fetchMyStudentArchive : fetchMyInstructorArchive,
  );
  return {
    semesters: sems.data ?? [],
    records: recs.data ?? [],
    loading: (sems.loading && !sems.data) || (recs.loading && !recs.data),
    offline: sems.offline || recs.offline,
    savedAt: recs.savedAt ?? sems.savedAt,
    error: sems.error ?? recs.error,
    refresh: async () => {
      await Promise.all([sems.refresh(), recs.refresh()]);
    },
  };
}

/** "My Semesters" (student) / "Previous Semesters" (instructor). */
export function SemesterList({ role }: { role: Role }) {
  const a = useSemesterArchive(role);
  const current = a.semesters.find((s) => s.status === 'active');
  const count = (id: string) => a.records.filter((r) => r.semester_id === id).length;
  const previous = a.semesters.filter((s) => s.status === 'completed' && count(s.id) > 0);

  return (
    <Screen onRefresh={a.refresh}>
      <Caption>
        {role === 'student'
          ? 'Your classes, grades and attendance from every semester you were enrolled in.'
          : 'Every class you handled in past semesters, with its students, grades and attendance.'}
      </Caption>
      <OfflineNote show={a.offline} savedAt={a.savedAt} />
      {a.loading ? <Loading /> : null}

      <Label>Current semester</Label>
      <Card style={styles.current}>
        <View style={styles.currentIcon}>
          <Ionicons name="calendar" size={20} color={colors.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <H2>{current ? semesterLabel(current) : 'No active semester'}</H2>
          <Caption>{current ? `${datesOf(current)} · open Home and Classes for this semester` : 'The administrator hasn’t started the next semester yet.'}</Caption>
        </View>
        {current ? <Pill label="Active" tone="green" /> : null}
      </Card>

      <Label>Previous semesters</Label>
      {previous.map((s) => (
        <MenuRow
          key={s.id}
          icon="archive-outline"
          title={semesterLabel(s)}
          body={`${count(s.id)} class${count(s.id) === 1 ? '' : 'es'} · ended ${fmtDate(s.ended_at ?? s.ends_on)}`}
          onPress={() => router.push(`/${role}/semester/${s.id}` as Href)}
        />
      ))}
      {!a.loading && !previous.length ? (
        <Empty
          icon="archive-outline"
          title="No previous semesters yet"
          body={role === 'student' ? 'When a semester ends, your classes and records appear here.' : 'When a semester ends, the classes you handled appear here.'}
        />
      ) : null}
    </Screen>
  );
}

/** Top card of an archived semester. */
export function SemesterHeader({ semester, children }: { semester: SemesterRef | undefined; children?: ReactNode }) {
  return (
    <Card tone="soft" style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <H2 style={{ flex: 1 }}>{semester ? semesterLabel(semester) : 'Semester'}</H2>
        <Pill label="Read-only" tone="muted" />
      </View>
      {semester ? <Caption>{datesOf(semester)} · ended {fmtDate(semester.ended_at)}</Caption> : null}
      {children}
    </Card>
  );
}

/** Small "label / value" figures in a row. */
export function Figures({ items }: { items: [string, string][] }) {
  return (
    <View style={styles.figures}>
      {items.map(([k, v]) => (
        <View key={k} style={styles.figure}>
          <Text style={styles.figureValue}>{v}</Text>
          <Text style={styles.figureLabel}>{k}</Text>
        </View>
      ))}
    </View>
  );
}

/** A student's archived class: tap to open grades, attendance, schedule and posts. */
export function StudentClassCard({ r }: { r: StudentClassRecord }) {
  const [open, setOpen] = useState(false);
  const d = r.data;
  const present = d.attendance.filter((x) => x.status === 'present').length;
  const taken = d.quizzes.filter((q) => q.attempt);
  const scores = taken.map((q) => pctOf(q.attempt)).filter((x): x is number => x != null);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return (
    <Card style={{ gap: 12 }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.classHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.classCode}>{r.code}</Text>
          <H2>{r.title}</H2>
          <Caption>
            {r.section} · {r.instructor_name || d.instructor?.full_name || 'Instructor'}
            {d.subject?.units ? ` · ${d.subject.units} units` : ''}
          </Caption>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
      </Pressable>

      <Figures
        items={[
          ['Average score', avg == null ? '—' : `${avg}%`],
          ['Quizzes taken', `${taken.length}/${d.quizzes.length}`],
          ['Attendance', d.attendance.length ? `${present}/${d.attendance.length}` : '—'],
        ]}
      />

      {open ? (
        <View style={{ gap: 14 }}>
          {d.schedule.length ? (
            <Block title="Schedule">
              {d.schedule.map((s, i) => (
                <Caption key={i}>{scheduleLine(s)}</Caption>
              ))}
            </Block>
          ) : null}

          <Block title="Grades & feedback">
            {d.quizzes.length ? (
              d.quizzes.map((q) => {
                const p = pctOf(q.attempt);
                const passed = p != null && p >= (q.passing_score ?? 0);
                return (
                  <View key={q.id} style={styles.line}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.lineTitle}>
                        {q.title}
                        {q.kind ? <Text style={styles.kind}> · {q.kind}</Text> : null}
                      </Text>
                      {q.attempt?.feedback ? <Text style={styles.feedback}>“{q.attempt.feedback}”</Text> : null}
                    </View>
                    {q.attempt ? (
                      q.attempt.needs_grading ? (
                        <Pill label="Not graded" tone="gold" />
                      ) : (
                        <Pill label={`${q.attempt.score ?? 0}/${q.attempt.total ?? 0}${p != null ? ` · ${p}%` : ''} · ${passed ? 'Passed' : 'Failed'}`} tone={passed ? 'green' : 'red'} />
                      )
                    ) : (
                      <Pill label="Not taken" tone="muted" />
                    )}
                  </View>
                );
              })
            ) : (
              <Caption>No quizzes or exams.</Caption>
            )}
          </Block>

          <Block title="Attendance">
            {d.attendance.length ? (
              <View style={styles.chips}>
                {d.attendance.map((x, i) => (
                  <View key={i} style={[styles.chip, x.status === 'present' ? styles.chipOk : styles.chipBad, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                    <Ionicons name={x.status === 'present' ? 'checkmark-circle' : 'close-circle'} size={13} color={x.status === 'present' ? colors.primary : colors.danger} />
                    <Text style={[styles.chipText, { color: x.status === 'present' ? colors.primary : colors.danger }]}>
                      {fmtDate(x.date)} · {x.status === 'present' ? 'Present' : 'Absent'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Caption>No attendance was recorded.</Caption>
            )}
          </Block>

          {d.assignments.length ? (
            <Block title="Assignments">
              {d.assignments.map((x) => (
                <View key={x.id} style={styles.line}>
                  <Text style={[styles.lineTitle, { flex: 1 }]}>{x.title}</Text>
                  <Caption>Due {fmtDate(x.due_at)}</Caption>
                </View>
              ))}
            </Block>
          ) : null}

          {d.announcements.length ? (
            <Block title="Announcements">
              {d.announcements.map((x) => (
                <View key={x.id} style={{ gap: 2 }}>
                  <Text style={styles.lineTitle}>{x.title}</Text>
                  {x.message ? <Caption>{x.message}</Caption> : null}
                  <Caption>
                    {x.author_name || 'Instructor'} · {fmtDate(x.created_at)}
                  </Caption>
                </View>
              ))}
            </Block>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Label>{title}</Label>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

export const styles = themed(() =>
  StyleSheet.create({
    current: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    currentIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    figures: { flexDirection: 'row', gap: 8 },
    figure: { flex: 1, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 10, gap: 2 },
    figureValue: { color: colors.primary, fontSize: 17, fontWeight: '800' },
    figureLabel: { color: colors.textSoft, fontSize: 11.5, fontWeight: '600' },
    classHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    classCode: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    block: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    lineTitle: { color: colors.text, fontSize: 14.5, fontWeight: '700' },
    kind: { color: colors.textSoft, fontWeight: '500' },
    feedback: { color: colors.textSoft, fontSize: 13, fontStyle: 'italic' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
    chipOk: { backgroundColor: colors.primarySoft },
    chipBad: { backgroundColor: colors.dangerSoft },
    chipText: { fontSize: 12, fontWeight: '700' },
    endedLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
    endedLinkText: { color: colors.primary, fontSize: 14.5, fontWeight: '800' },
  }),
);

/** Home-screen card when no semester is running: the last one ended, records are safe, next one is coming. */
export function SemesterEndedCard({ role }: { role: Role }) {
  const { data } = useRemote('semesters', fetchSemesters);
  if (!data || data.some((s) => s.status === 'active')) return null;
  const last = data.find((s) => s.status === 'completed');
  return (
    <Card style={{ gap: 10, borderColor: colors.gold, borderWidth: 1.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[styles.currentIcon, { backgroundColor: colors.gold }]}>
          <Ionicons name="flag" size={20} color="#3D2F00" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <H2>{last ? `${semesterLabel(last)} has ended` : 'No semester yet'}</H2>
          <Caption>{last?.ended_at ? `Ended ${fmtDate(last.ended_at)}` : 'No semester is running right now.'}</Caption>
        </View>
      </View>
      <Caption style={{ color: colors.text }}>
        {!last
          ? 'No semester is running right now. You’ll get a notification when the next semester opens.'
          : role === 'student'
            ? 'Your classes, grades and attendance are saved in My Semesters. Renew your enrollment for the next semester below.'
            : 'Your classes, grades and attendance are saved in Previous Semesters. Confirm your status for the next semester below.'}
      </Caption>
      {last ? (
      <Pressable onPress={() => router.push(`/${role}/semesters` as Href)} accessibilityRole="button" style={({ pressed }) => [styles.endedLink, pressed && { opacity: 0.7 }]}>
        <Text style={styles.endedLinkText}>{role === 'student' ? 'Open My Semesters' : 'Open Previous Semesters'}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
      </Pressable>
      ) : null}
    </Card>
  );
}

/** True when no semester is running (between semesters): Home then shows only the semester-ended card. */
export function useSemesterEnded() {
  const { data } = useRemote('semesters', fetchSemesters);
  return !!data && !data.some((s) => s.status === 'active');
}
