import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Caption, Card, Empty, H2, Label, Row } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyTimetable, type OfficialClass, type Term } from '@/lib/data';
import { DAYS, fmtTime } from '@/lib/format';

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

/** Weekly teaching hours for a list of classes. */
export function weeklyHours(classes: OfficialClass[]) {
  const mins = classes.reduce((n, c) => {
    const [sh, sm] = c.start_time.split(':').map(Number);
    const [eh, em] = c.end_time.split(':').map(Number);
    return n + (eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round((mins / 60) * 10) / 10;
}

const styles = StyleSheet.create({
  term: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  termText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  termDates: { color: colors.textSoft, fontSize: 12, marginTop: 1 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
});
