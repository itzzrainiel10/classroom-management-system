import { StyleSheet, Text, View } from 'react-native';

import { Caption, Card, Empty, H2, Label, Loading, OfflineNote, ProgressBar, Row, Screen } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyAttendance, type MyAttendanceRow } from '@/lib/data';

const nice = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

/** The student's own attendance per class (read-only; taken by the instructor). */
export default function MyAttendance() {
  const { data, loading, offline, savedAt, refresh } = useRemote('my-attendance', fetchMyAttendance);
  const byClass = new Map<string, MyAttendanceRow[]>();
  for (const r of data ?? []) byClass.set(r.class.id, [...(byClass.get(r.class.id) ?? []), r]);
  const all = data ?? [];
  const presentAll = all.filter((r) => r.status === 'present').length;

  return (
    <Screen onRefresh={refresh}>
      <OfflineNote show={offline} savedAt={savedAt} />
      {loading && !data ? <Loading /> : null}
      {data && !data.length ? <Empty icon="checkmark-done-outline" title="No attendance yet" body="When your instructors take attendance, your record shows here." /> : null}
      {all.length ? (
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Overall attendance</H2>
            <Text style={styles.big}>{Math.round((presentAll / all.length) * 100)}%</Text>
          </Row>
          <ProgressBar value={presentAll / all.length} tone="green" />
          <Caption>
            Present {presentAll} of {all.length} class meetings
          </Caption>
        </Card>
      ) : null}
      {[...byClass.entries()].map(([id, rows]) => {
        const p = rows.filter((r) => r.status === 'present').length;
        const c = rows[0].class;
        return (
          <View key={id} style={{ gap: 8 }}>
            <Label>
              {c.code} · {c.section}
            </Label>
            <Card style={{ gap: 10 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <H2>{c.title}</H2>
                  <Caption>
                    {p} present · {rows.length - p} absent
                  </Caption>
                </View>
                <Text style={[styles.rate, p / rows.length < 0.8 && { color: colors.danger }]}>{Math.round((p / rows.length) * 100)}%</Text>
              </Row>
              <View style={styles.chips}>
                {rows.slice(0, 12).map((r) => (
                  <View key={r.session_date} style={[styles.chip, r.status === 'absent' && styles.chipAbsent]}>
                    <Text style={[styles.chipText, r.status === 'absent' && { color: colors.danger }]}>
                      {nice(r.session_date)} · {r.status === 'present' ? 'Present' : 'Absent'}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 22, fontWeight: '800', color: colors.primary },
  rate: { fontSize: 20, fontWeight: '800', color: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  chipAbsent: { backgroundColor: colors.dangerSoft },
  chipText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
});
