import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Row, Screen } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { ChooseSectionCard } from '@/components/section-picker';
import { OfficialClassCard, SemesterEnded, TermBanner, inSession, termPhase, useTimetable } from '@/components/official-schedule';
import { useStudentHome } from '@/hooks/use-student';
import { DAY_SHORT, dayName, fmtTime, isoWeekday } from '@/lib/format';

function weekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoWeekday(today) - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export default function StudentSchedule() {
  const { data, loading, offline, savedAt, refresh: refreshHome } = useStudentHome();
  const timetable = useTimetable();
  const refresh = () => {
    refreshHome();
    timetable.refresh();
  };
  const days = weekDates();
  const todayIdx = Math.min(isoWeekday(), 5);
  const [day, setDay] = useState(todayIdx);
  const first = days[0];
  const last = days[4];
  const range = first && last ? `${first.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}–${last.getDate()}, ${last.getFullYear()}` : '';
  const selectedDate = days[day - 1];
  const ended = termPhase(timetable.data?.term) === 'ended';
  // Before the first day the timetable is shown as a preview; after the last day nothing is listed.
  const showOfficial = !ended && (termPhase(timetable.data?.term) === 'upcoming' || !selectedDate || inSession(timetable.data?.term, selectedDate));
  const official = showOfficial ? (timetable.data?.classes ?? []).filter((c) => c.day_of_week === day) : [];
  const section = timetable.data?.section;
  const items = (data?.schedules ?? []).filter((s) => s.day_of_week === day).sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Student" title="Schedule" subtitle={`Your week at a glance · ${range}`} />
        <OfflineNote show={offline || timetable.offline} savedAt={savedAt ?? timetable.savedAt} />
        <TermBanner term={timetable.data?.term} extra={section ? section.name : 'No section yet'} />
        {timetable.data && !section ? <ChooseSectionCard onChosen={refresh} /> : null}
        <View style={styles.week}>
          {days.map((d, i) => {
            const active = day === i + 1;
            return (
              <Pressable key={i} onPress={() => setDay(i + 1)} style={[styles.day, active && styles.dayActive]}>
                <Text style={[styles.dayShort, active && { color: colors.gold }]}>{DAY_SHORT[i]}</Text>
                <Text style={[styles.dayNum, active && { color: colors.onPrimary }]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
        </View>
        <Label>{dayName(day)}</Label>
        {(loading && !data) || (timetable.loading && !timetable.data) ? <Loading /> : null}
        {ended ? <SemesterEnded term={timetable.data?.term} /> : null}
        {data && timetable.data && items.length === 0 && official.length === 0 ? <Empty icon="sunny-outline" title="No classes" body="Nothing scheduled on this day." /> : null}
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
});
