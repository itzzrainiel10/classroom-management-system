import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Row, Screen, Segmented } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { ChooseSectionCard } from '@/components/section-picker';
import { OfficialClassCard, SemesterEnded, TermBanner, inSession, termPhase, useTimetable } from '@/components/official-schedule';
import { useStudentHome } from '@/hooks/use-student';
import type { Term } from '@/lib/data';
import { DAY_SHORT, fmtTime, isoWeekday } from '@/lib/format';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function weekDates() {
  const today = startOfDay(new Date());
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoWeekday(today) - 1));
  return Array.from({ length: 5 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** Six rows of 7 days (Mon–Sun) covering the given month. */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - (isoWeekday(first) - 1));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Classes on a date: weekly timetable, limited to the semester's dates (preview allowed before it starts). */
function classesOn(date: Date, term: Term | null | undefined, officialDays: Set<number>, extraDays: Set<number>) {
  const phase = termPhase(term, date);
  if (phase === 'ended') return 0;
  const dow = isoWeekday(date);
  return (officialDays.has(dow) ? 1 : 0) + (extraDays.has(dow) ? 1 : 0);
}

function MonthCalendar({
  selected,
  onSelect,
  hasClasses,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  hasClasses: (d: Date) => boolean;
}) {
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const today = startOfDay(new Date());
  const cells = monthGrid(month);
  // drop a trailing row that belongs entirely to the next month
  const rows = cells.slice(35).every((d) => d.getMonth() !== month.getMonth()) ? 5 : 6;
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <Card style={{ gap: 10, paddingHorizontal: 10 }}>
      <Row style={{ paddingHorizontal: 4 }}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.navBtn} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </Pressable>
        <Pressable
          style={{ flex: 1, alignItems: 'center' }}
          onPress={() => {
            setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            onSelect(today);
          }}
          accessibilityLabel="Go to today">
          <H2>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</H2>
          <Caption>Tap a date to see its classes</Caption>
        </Pressable>
        <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.navBtn} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      </Row>

      <View style={styles.gridRow}>
        {DAY_SHORT.map((d) => (
          <Text key={d} style={styles.gridHead}>
            {d.slice(0, 2)}
          </Text>
        ))}
      </View>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.gridRow}>
          {cells.slice(r * 7, r * 7 + 7).map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const isSel = sameDay(d, selected);
            const isToday = sameDay(d, today);
            const busy = hasClasses(d);
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => {
                  onSelect(d);
                  if (!inMonth) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                }}
                style={[styles.cell, isToday && styles.cellToday, isSel && styles.cellSel]}
                accessibilityLabel={`${d.toDateString()}${busy ? ', has classes' : ''}`}>
                <Text style={[styles.cellNum, !inMonth && { color: colors.muted, opacity: 0.6 }, isSel && { color: colors.onPrimary }]}>{d.getDate()}</Text>
                <View style={[styles.dot, !busy && { opacity: 0 }, isSel && { backgroundColor: colors.gold }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

export default function StudentSchedule() {
  const { data, loading, offline, savedAt, refresh: refreshHome } = useStudentHome();
  const timetable = useTimetable();
  const refresh = () => {
    refreshHome();
    timetable.refresh();
  };
  const [view, setView] = useState<'week' | 'month'>('week');
  const days = weekDates();
  const today = startOfDay(new Date());
  const [selected, setSelected] = useState<Date>(days[Math.min(isoWeekday(today), 5) - 1]);

  const term = timetable.data?.term;
  const allOfficial = timetable.data?.classes ?? [];
  const allExtra = data?.schedules ?? [];
  const officialDays = new Set(allOfficial.map((c) => c.day_of_week));
  const extraDays = new Set(allExtra.map((s) => s.day_of_week));
  const hasClasses = (d: Date) => {
    const p = termPhase(term, d);
    return (p === 'unset' || p === 'ongoing') && classesOn(d, term, officialDays, extraDays) > 0;
  };

  const first = days[0];
  const last = days[4];
  const range = `${first.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}–${last.getDate()}, ${last.getFullYear()}`;
  const day = isoWeekday(selected);
  const ended = termPhase(term) === 'ended';
  // Before the first day the timetable is shown as a preview; after the last day nothing is listed.
  const showOfficial = !ended && (termPhase(term) === 'upcoming' || inSession(term, selected));
  const official = showOfficial ? allOfficial.filter((c) => c.day_of_week === day) : [];
  const section = timetable.data?.section;
  const items = showOfficial ? allExtra.filter((s) => s.day_of_week === day).sort((a, b) => a.start_time.localeCompare(b.start_time)) : [];
  const outside = !ended && termPhase(term) !== 'upcoming' && !inSession(term, selected);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Student" title="Schedule" subtitle={view === 'week' ? `Your week at a glance · ${range}` : 'Your classes month by month'} />
        <OfflineNote show={offline || timetable.offline} savedAt={savedAt ?? timetable.savedAt} />
        <TermBanner term={term} extra={section ? section.name : 'No section yet'} />
        {timetable.data && !section ? <ChooseSectionCard onChosen={refresh} /> : null}

        <Segmented
          options={[
            { label: 'Week', value: 'week' },
            { label: 'Month', value: 'month' },
          ]}
          value={view}
          onChange={(v) => {
            setView(v);
            // back in week view, pick the same weekday this week (Mon–Fri)
            if (v === 'week' && !days.some((d) => sameDay(d, selected))) setSelected(days[Math.min(isoWeekday(selected), 5) - 1]);
          }}
        />

        {view === 'week' ? (
          <View style={styles.week}>
            {days.map((d, i) => {
              const active = sameDay(d, selected);
              return (
                <Pressable key={i} onPress={() => setSelected(d)} style={[styles.day, active && styles.dayActive]}>
                  <Text style={[styles.dayShort, active && { color: colors.gold }]}>{DAY_SHORT[i]}</Text>
                  <Text style={[styles.dayNum, active && { color: colors.onPrimary }]}>{d.getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <MonthCalendar selected={selected} onSelect={setSelected} hasClasses={hasClasses} />
        )}

        <Label>
          {selected.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {sameDay(selected, today) ? ' · Today' : ''}
        </Label>
        {(loading && !data) || (timetable.loading && !timetable.data) ? <Loading /> : null}
        {ended ? <SemesterEnded term={term} /> : null}
        {data && timetable.data && !ended && items.length === 0 && official.length === 0 ? (
          <Empty icon="sunny-outline" title="No classes" body={outside ? 'This date is outside the semester.' : 'Nothing scheduled on this day.'} />
        ) : null}
        {official.map((c) => (
          <OfficialClassCard key={c.id} c={c} viewer="student" />
        ))}
        {items.length ? <Label>Other class meetings</Label> : null}
        {items.map((s) => (
          <Card key={s.id}>
            <Row>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.gold }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Caption style={{ fontWeight: '800', color: colors.primary }}>
                  {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                </Caption>
                <H2>{s.class ? `${s.class.code} · ${s.class.title}` : 'Class'}</H2>
                <Caption>
                  Section {s.class?.section}
                  {s.room ? ` · ${s.room}` : ''}
                </Caption>
              </View>
            </Row>
          </Card>
        ))}
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', gap: 8 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 2 },
  dayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayShort: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.8 },
  dayNum: { fontSize: 18, fontWeight: '800', color: colors.text },
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  gridRow: { flexDirection: 'row' },
  gridHead: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.muted, paddingBottom: 2 },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, gap: 3, margin: 1 },
  cellToday: { borderWidth: 1.5, borderColor: colors.primary },
  cellSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  cellNum: { fontSize: 15, fontWeight: '700', color: colors.text },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
});
