import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Caption, Card, Empty, H2, Label, Row } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyTimetable, type OfficialClass, type Term } from '@/lib/data';
import { DAY_SHORT, DAYS, fmtTime } from '@/lib/format';

const localDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const shortDay = (iso: string) => localDay(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Where a date falls in the semester. Without dates set, every day counts as in session. */
export function termPhase(term: Term | null | undefined, on = new Date()): 'unset' | 'upcoming' | 'ongoing' | 'ended' {
  if (!term?.semester_start || !term.semester_end) return 'unset';
  const day = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  if (day < localDay(term.semester_start)) return 'upcoming';
  if (day > localDay(term.semester_end)) return 'ended';
  return 'ongoing';
}

/** True when classes meet on this date (inside the semester's dates, or no dates set). */
export const inSession = (term: Term | null | undefined, on: Date) => {
  const p = termPhase(term, on);
  return p === 'unset' || p === 'ongoing';
};

/** "Aug 11 – Dec 19" for the semester, or null when dates aren't set. */
export function termDates(term: Term | null | undefined) {
  if (!term?.semester_start || !term.semester_end) return null;
  return `${shortDay(term.semester_start)} – ${shortDay(term.semester_end)}, ${localDay(term.semester_end).getFullYear()}`;
}

/** Official timetable for the signed-in user (cached for offline use). */
export function useTimetable() {
  return useRemote('my-timetable', fetchMyTimetable);
}

export function TermBanner({ term, extra }: { term: Term | null | undefined; extra?: string }) {
  if (!term) return null;
  const phase = termPhase(term);
  const dates = termDates(term);
  return (
    <View style={[styles.term, phase === 'ended' && { backgroundColor: colors.dangerSoft }, phase === 'upcoming' && { backgroundColor: colors.goldSoft }]}>
      <Ionicons name="school-outline" size={16} color={phase === 'ended' ? colors.danger : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.termText, phase === 'ended' && { color: colors.danger }]}>
          {term.current_semester} · AY {term.current_academic_year}
          {extra ? ` · ${extra}` : ''}
        </Text>
        {dates ? (
          <Text style={styles.termDates}>
            {phase === 'upcoming' ? `Classes start ${shortDay(term.semester_start!)} · ` : phase === 'ended' ? 'Semester ended · ' : 'Classes every week · '}
            {dates}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Shown instead of the timetable once the semester's last day has passed. */
export function SemesterEnded({ term }: { term: Term | null | undefined }) {
  return <Empty icon="checkmark-done-outline" title="This semester has ended" body={`Classes ran ${termDates(term) ?? ''}. Your new schedule appears when the next semester is set up.`} />;
}

/** One official class: subject, time, section, room, instructor. */
export function OfficialClassCard({ c, viewer }: { c: OfficialClass; viewer: 'student' | 'instructor' }) {
  return (
    <Card style={{ paddingVertical: 12 }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={styles.bar} />
        <View style={{ flex: 1, gap: 3 }}>
          <Caption style={{ fontWeight: '800', color: colors.primary }}>
            {fmtTime(c.start_time)}–{fmtTime(c.end_time)}
          </Caption>
          <H2>
            {c.subject_code} · {c.subject_name}
          </H2>
          <Caption>
            {viewer === 'instructor' ? `${c.section_name} · ` : ''}
            {c.room}
            {viewer === 'student' ? ` · ${c.instructor_name}` : ''}
          </Caption>
        </View>
      </Row>
    </Card>
  );
}

/** Whole week grouped by day. */
export function OfficialWeek({ classes, viewer, emptyBody }: { classes: OfficialClass[]; viewer: 'student' | 'instructor'; emptyBody: string }) {
  if (!classes.length) return <Empty icon="calendar-outline" title="No official classes yet" body={emptyBody} />;
  return (
    <>
      {DAYS.map((day, i) => {
        const rows = classes.filter((c) => c.day_of_week === i + 1);
        if (!rows.length) return null;
        return (
          <View key={day} style={{ gap: 8 }}>
            <Label>{day}</Label>
            {rows.map((c) => (
              <OfficialClassCard key={c.id} c={c} viewer={viewer} />
            ))}
          </View>
        );
      })}
    </>
  );
}

/* ---------- Week planner: one real calendar week at a time ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;
const mondayOf = (d: Date) => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export type ExtraMeeting = { id: string; day_of_week: number; start_time: string; end_time: string; room: string; title: string; section?: string };
type Slot = { key: string; start: string; end: string; title: string; sub: string; extra: boolean };

/** Calendar week view: pick a week and a day, see that day's classes (official + extra meetings). */
export function WeekPlanner({
  classes,
  extras = [],
  term,
  viewer = 'instructor',
}: {
  classes: OfficialClass[];
  extras?: ExtraMeeting[];
  term: Term | null | undefined;
  viewer?: 'student' | 'instructor';
}) {
  const today = new Date();
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState((today.getDay() + 6) % 7);

  const monday = addDays(mondayOf(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const slotsFor = (i: number): Slot[] => {
    if (!inSession(term, days[i])) return [];
    const dow = i + 1;
    return [
      ...classes
        .filter((c) => c.day_of_week === dow)
        .map((c) => ({ key: c.id, start: c.start_time, end: c.end_time, title: `${c.subject_code} · ${c.subject_name}`, sub: viewer === 'student' ? `${c.room} · ${c.instructor_name}` : `${c.section_name} · ${c.room}`, extra: false })),
      ...extras
        .filter((e) => e.day_of_week === dow)
        .map((e) => ({ key: `x${e.id}`, start: e.start_time, end: e.end_time, title: e.title, sub: [e.section && `Section ${e.section}`, e.room].filter(Boolean).join(' · '), extra: true })),
    ].sort((a, b) => a.start.localeCompare(b.start));
  };
  const weekSlots = days.map((_, i) => slotsFor(i));
  const total = weekSlots.reduce((n, s) => n + s.length, 0);
  const daySlots = weekSlots[picked];

  const label = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `${md(monday)} week`;
  const semWeek =
    term?.semester_start && inSession(term, addDays(monday, 6)) && termPhase(term, monday) !== 'upcoming'
      ? Math.floor((monday.getTime() - mondayOf(localDay(term.semester_start)).getTime()) / (7 * DAY_MS)) + 1
      : null;

  const go = (n: number) => {
    setOffset(offset + n);
    setPicked(0);
  };
  const goToday = () => {
    setOffset(0);
    setPicked((today.getDay() + 6) % 7);
  };

  return (
    <Card style={{ gap: 12 }}>
      <Row>
        <Pressable onPress={() => go(-1)} hitSlop={10} accessibilityLabel="Previous week" style={styles.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </Pressable>
        <Pressable onPress={goToday} style={{ flex: 1, alignItems: 'center' }} accessibilityLabel="Go to this week">
          <H2>{label}</H2>
          <Caption>
            {md(days[0])} – {md(days[6])}
            {semWeek ? ` · Week ${semWeek}` : ''} · {total} {total === 1 ? 'class' : 'classes'}
          </Caption>
        </Pressable>
        <Pressable onPress={() => go(1)} hitSlop={10} accessibilityLabel="Next week" style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      </Row>

      <View style={styles.strip}>
        {days.map((d, i) => {
          const on = i === picked;
          const isToday = sameDay(d, today);
          return (
            <Pressable key={i} onPress={() => setPicked(i)} style={[styles.day, on && styles.dayOn]} accessibilityLabel={`${DAYS[i]} ${md(d)}`}>
              <Text style={[styles.dayName, on && { color: colors.onPrimary }]}>{DAY_SHORT[i]}</Text>
              <Text style={[styles.dayNum, on && { color: colors.onPrimary }, !on && isToday && { color: colors.primary }]}>{d.getDate()}</Text>
              <View style={[styles.dot, !weekSlots[i].length && { opacity: 0 }, on && { backgroundColor: colors.gold }]} />
            </Pressable>
          );
        })}
      </View>

      <Label>
        {DAYS[picked]}, {md(days[picked])}
        {sameDay(days[picked], today) ? ' · Today' : ''}
      </Label>
      {daySlots.length === 0 ? (
        <Caption>{inSession(term, days[picked]) ? 'No classes on this day.' : 'No classes — outside the semester dates.'}</Caption>
      ) : (
        daySlots.map((s) => (
          <Row key={s.key} style={{ alignItems: 'flex-start' }}>
            <View style={[styles.bar, s.extra && { backgroundColor: colors.gold }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Caption style={{ fontWeight: '800', color: colors.primary }}>
                {fmtTime(s.start)}–{fmtTime(s.end)}
                {s.extra ? '  · Extra meeting' : ''}
              </Caption>
              <H2>{s.title}</H2>
              {s.sub ? <Caption>{s.sub}</Caption> : null}
            </View>
          </Row>
        ))
      )}
    </Card>
  );
}

/**
 * Compact weekly timetable as a table (like the admin website).
 * Instructor: Section · Day · Time · Subject · Room, grouped by section.
 * Student:    Day · Time · Subject · Room · Instructor, grouped by day (it is always their own section).
 */
export function ScheduleTable({ classes, emptyBody, viewer = 'instructor' }: { classes: OfficialClass[]; emptyBody: string; viewer?: 'student' | 'instructor' }) {
  if (!classes.length) return <Empty icon="calendar-outline" title="No official classes yet" body={emptyBody} />;
  const student = viewer === 'student';
  const rows = [...classes].sort((a, b) =>
    student
      ? a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)
      : a.section_name.localeCompare(b.section_name) || a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );
  const short = (t: string) => fmtTime(t).replace(' AM', 'a').replace(' PM', 'p');
  let group = -1;
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        {student ? null : <Text style={[styles.th, styles.cSec]}>Section</Text>}
        <Text style={[styles.th, styles.cDay]}>Day</Text>
        <Text style={[styles.th, styles.cTime]}>Time</Text>
        <Text style={[styles.th, styles.cSubj]}>Subject</Text>
        <Text style={[styles.th, styles.cRoom]}>Room</Text>
        {student ? <Text style={[styles.th, styles.cSec]}>Instructor</Text> : null}
      </View>
      {rows.map((c, i) => {
        const newSection = !student && (i === 0 || rows[i - 1].section_name !== c.section_name);
        const newDay = i === 0 || newSection || rows[i - 1].day_of_week !== c.day_of_week;
        const newGroup = student ? newDay : newSection;
        if (newGroup) group++;
        return (
          <View key={c.id} style={[styles.tr, newGroup && i > 0 && styles.dayBreak, group % 2 === 1 && { backgroundColor: colors.rowAlt }]}>
            {student ? null : (
              <Text style={[styles.td, styles.cSec, { fontWeight: '700', color: colors.text }]} numberOfLines={2}>
                {newSection ? c.section_name : ''}
              </Text>
            )}
            <Text style={[styles.td, styles.cDay, student && { fontWeight: '700', color: colors.text }]}>{newDay ? DAY_SHORT[c.day_of_week - 1] : ''}</Text>
            <Text style={[styles.td, styles.cTime]}>
              {short(c.start_time)}–{short(c.end_time)}
            </Text>
            <View style={styles.cSubj}>
              <Text style={[styles.td, { fontWeight: '700', color: colors.text }]}>{c.subject_code}</Text>
              <Text style={styles.tdSmall} numberOfLines={1}>
                {c.subject_name}
              </Text>
            </View>
            <Text style={[styles.td, styles.cRoom]} numberOfLines={2}>
              {c.room}
            </Text>
            {student ? (
              <Text style={[styles.td, styles.cSec]} numberOfLines={2}>
                {c.instructor_name}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Weekly teaching hours for a list of classes. */
export function weeklyHours(classes: OfficialClass[]) {
  const mins = classes.reduce((n, c) => {
    const [sh, sm] = c.start_time.split(':').map(Number);
    const [eh, em] = c.end_time.split(':').map(Number);
    return n + (eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round((mins / 60) * 10) / 10;
}

const styles = themed(() => StyleSheet.create({
  term: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  termText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  termDates: { color: colors.textSoft, fontSize: 12, marginTop: 1 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, gap: 2 },
  dayOn: { backgroundColor: colors.primary },
  dayName: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.muted },
  dayNum: { fontSize: 16, fontWeight: '800', color: colors.text },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  table: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.tableLine, borderRadius: 6, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 7, gap: 4 },
  thead: { backgroundColor: colors.tableHead, borderBottomWidth: 1, borderBottomColor: colors.tableLine, paddingVertical: 6 },
  dayBreak: { borderTopWidth: 1, borderTopColor: colors.line },
  th: { fontSize: 10.5, fontWeight: '700', color: colors.textSoft },
  td: { fontSize: 11, color: colors.textSoft },
  tdSmall: { fontSize: 10, color: colors.muted },
  cDay: { width: 30 },
  cTime: { width: 66 },
  cSubj: { flex: 1.3 },
  cSec: { flex: 1 },
  cRoom: { flex: 1 },
}));
