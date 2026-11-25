import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, Button, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Pill, Row, Screen } from '@/components/ui';
import { OfficialWeek, SemesterEnded, TermBanner, termPhase, useTimetable, weeklyHours } from '@/components/official-schedule';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { deleteOp, fetchSchedules, type Schedule } from '@/lib/data';
import { DAYS, fmtTime } from '@/lib/format';
import { pendingDeletes, pendingRows } from '@/lib/offline';
import { useOutbox } from '@/lib/outbox';

export async function mergeSchedules(list: Schedule[]) {
  const [pending, deleted] = await Promise.all([pendingRows<Schedule>('class_schedules'), pendingDeletes('class_schedules')]);
  const ids = new Set(list.map((s) => s.id));
  return [...list, ...pending.filter((p) => !ids.has(p.id))].filter((s) => !deleted.has(s.id));
}

export function ScheduleList({ items, onDelete }: { items: Schedule[]; onDelete?: (s: Schedule) => void }) {
  return (
    <>
      {DAYS.map((day, i) => {
        const rows = items.filter((s) => s.day_of_week === i + 1).sort((a, b) => a.start_time.localeCompare(b.start_time));
        if (!rows.length) return null;
        return (
          <View key={day} style={{ gap: 8 }}>
            <Label>{day}</Label>
            {rows.map((s) => (
              <Card key={s.id} style={{ paddingVertical: 12 }}>
                <Row>
                  <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.gold }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <H2>{s.class ? `${s.class.code} · ${s.class.title}` : 'Class'}</H2>
                    <Caption>
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      {s.class ? ` · Section ${s.class.section}` : ''}
                      {s.room ? ` · ${s.room}` : ''}
                    </Caption>
                  </View>
                  {s._pending ? <Pill label="Waiting" tone="gold" /> : null}
                  {onDelete ? (
                    <Pressable onPress={() => onDelete(s)} hitSlop={8} accessibilityLabel="Remove schedule">
                      <Ionicons name="trash-outline" size={18} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </Row>
              </Card>
            ))}
          </View>
        );
      })}
    </>
  );
}

export default function InstructorSchedule() {
  const { save } = useOutbox();
  const { data, loading, offline, savedAt, refresh: refreshOwn } = useRemote('schedules', fetchSchedules, mergeSchedules);
  const timetable = useTimetable();
  const official = timetable.data?.classes ?? [];
  const refresh = () => {
    refreshOwn();
    timetable.refresh();
  };
  const remove = (s: Schedule) =>
    Alert.alert('Remove this time slot?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { const o = deleteOp('class_schedules', s.id, 'Remove schedule'); save(o.op, o.label); } },
    ]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Screen onRefresh={refresh}>
        <AppHeader crumb="Instructor" title="Teaching Schedule" subtitle="Your official classes, set by the administrator." />
        <OfflineNote show={offline || timetable.offline} savedAt={savedAt ?? timetable.savedAt} />
        <TermBanner
          term={timetable.data?.term}
          extra={official.length ? `${new Set(official.map((c) => c.subject_code)).size} subjects · ${new Set(official.map((c) => c.section_name)).size} sections · ${weeklyHours(official)} h/week` : undefined}
        />
        {timetable.loading && !timetable.data ? <Loading /> : null}
        {timetable.data && termPhase(timetable.data.term) === 'ended' ? <SemesterEnded term={timetable.data.term} /> : null}
        {timetable.data && termPhase(timetable.data.term) !== 'ended' ? (
          <OfficialWeek classes={official} viewer="instructor" emptyBody="When an administrator assigns you to a subject and section, it appears here." />
        ) : null}
        <Card tone="soft" style={{ gap: 4 }}>
          <Row style={{ gap: 8 }}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
            <H2 style={{ flex: 1 }}>Official schedule is managed by the administrator</H2>
          </Row>
          <Caption>Ask your administrator for changes. You’ll get a notification whenever it’s updated.</Caption>
        </Card>

        <Label>Extra class meetings (yours)</Label>
        <Button title="Add an extra class meeting" icon="add" variant="secondary" onPress={() => router.push('/instructor/schedule-new')} />
        {loading && !data ? <Loading /> : null}
        {data && data.length === 0 ? <Caption>Optional: consultations, make-up classes or lab sessions for your own classes.</Caption> : null}
        {data ? <ScheduleList items={data} onDelete={remove} /> : null}
      </Screen>
    </SafeAreaView>
  );
}
