import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ClassPicker } from '@/components/pickers';
import { Button, Caption, Card, Empty, H2, Label, Loading, OfflineNote, Row, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { useRemote } from '@/hooks/use-remote';
import { attendanceOp, fetchClassAttendance, fetchClassDetail, type AttendanceStatus } from '@/lib/data';
import { useOutbox } from '@/lib/outbox';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const nice = (s: string) => fromIso(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** Take attendance (Present / Absent) for one of your classes. Saved offline too, uploaded when online. */
export default function TakeAttendance() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { data: classes } = useClasses();
  const { save } = useOutbox();
  const [classId, setClassId] = useState<string | null>(params.classId ?? null);
  const [date, setDate] = useState(iso(new Date()));
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!classId && classes?.length) setClassId(classes[0].id);
  }, [classes, classId]);

  const detail = useRemote(`class-${classId ?? 'none'}`, () => (classId ? fetchClassDetail(classId) : Promise.resolve(null)));
  const history = useRemote(`attendance-${classId ?? 'none'}`, () => (classId ? fetchClassAttendance(classId) : Promise.resolve({ sessions: [], records: [] })));
  const students = useMemo(() => detail.data?.students ?? [], [detail.data]);
  const session = history.data?.sessions.find((s) => s.session_date === date);

  // Start from what was saved for this date, otherwise everyone Present.
  useEffect(() => {
    const recs = session ? (history.data?.records ?? []).filter((r) => r.session_id === session.id) : [];
    const next: Record<string, AttendanceStatus> = {};
    for (const s of students) next[s.email.toLowerCase()] = recs.find((r) => r.student_email === s.email.toLowerCase())?.status ?? 'present';
    setMarks(next);
    setSaved(null);
  }, [students, session, history.data]);

  const present = Object.values(marks).filter((m) => m === 'present').length;
  const total = Object.keys(marks).length;
  const today = iso(new Date());
  const shift = (days: number) => {
    const d = fromIso(date);
    d.setDate(d.getDate() + days);
    const next = iso(d);
    if (next <= today) setDate(next);
  };
  const cls = classes?.find((c) => c.id === classId);

  const submit = async () => {
    if (!classId || !total) return;
    const o = attendanceOp(classId, date, Object.entries(marks).map(([email, status]) => ({ email, status })), `${cls?.code ?? 'Class'} ${nice(date)}`);
    await save(o.op, o.label);
    setSaved(`Saved · ${present}/${total} present`);
    history.refresh();
  };

  return (
    <Screen
      onRefresh={() => {
        detail.refresh();
        history.refresh();
      }}
      footer={total ? <Button title={session ? 'Update attendance' : 'Save attendance'} icon="checkmark-done" onPress={submit} /> : undefined}>
      <OfflineNote show={detail.offline || history.offline} savedAt={detail.savedAt} />
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}

      <Card style={{ gap: 10 }}>
        <Row>
          <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.navBtn} accessibilityLabel="Previous day">
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <H2>{date === today ? `Today · ${nice(date)}` : nice(date)}</H2>
            <Caption>{session ? 'Already saved — changes update it' : 'Not taken yet — everyone starts Present'}</Caption>
          </View>
          <Pressable onPress={() => shift(1)} hitSlop={10} style={[styles.navBtn, date >= today && { opacity: 0.3 }]} disabled={date >= today} accessibilityLabel="Next day">
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
        </Row>
        {total ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Caption>
              <Text style={{ fontWeight: '800', color: colors.primary }}>{present}</Text> present ·{' '}
              <Text style={{ fontWeight: '800', color: colors.danger }}>{total - present}</Text> absent
            </Caption>
            <Pressable onPress={() => setMarks(Object.fromEntries(Object.keys(marks).map((k) => [k, 'present'])))} hitSlop={8}>
              <Text style={styles.link}>All present</Text>
            </Pressable>
          </Row>
        ) : null}
        {saved ? <Caption style={{ color: colors.primary, fontWeight: '700' }}>{saved}</Caption> : null}
      </Card>

      {detail.loading && !detail.data ? <Loading /> : null}
      {detail.data && !students.length ? <Empty icon="people-outline" title="No students enrolled" body="Add students to this class first (Manage classes)." /> : null}
      {students.length ? <Label>Students</Label> : null}
      {students.map((s) => {
        const key = s.email.toLowerCase();
        const m = marks[key] ?? 'present';
        return (
          <Card key={s.id} style={{ paddingVertical: 10 }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {s.full_name || s.email}
                </Text>
                <Caption numberOfLines={1}>{s.email}</Caption>
              </View>
              <View style={styles.toggle}>
                {(['present', 'absent'] as const).map((st) => (
                  <Pressable
                    key={st}
                    onPress={() => setMarks({ ...marks, [key]: st })}
                    style={[styles.opt, m === st && (st === 'present' ? styles.optPresent : styles.optAbsent)]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: m === st }}>
                    <Text style={[styles.optText, m === st && { color: colors.onPrimary }]}>{st === 'present' ? 'Present' : 'Absent'}</Text>
                  </Pressable>
                ))}
              </View>
            </Row>
          </Card>
        );
      })}

      {history.data?.sessions.length ? (
        <>
          <Label>Past meetings</Label>
          {history.data.sessions.slice(0, 10).map((s) => {
            const recs = history.data!.records.filter((r) => r.session_id === s.id);
            const p = recs.filter((r) => r.status === 'present').length;
            return (
              <Pressable key={s.id} onPress={() => setDate(s.session_date)}>
                <Card style={[{ paddingVertical: 10 }, s.session_date === date && { borderColor: colors.primary }]}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={styles.name}>{nice(s.session_date)}</Text>
                    <Caption>
                      {p}/{recs.length} present
                    </Caption>
                  </Row>
                </Card>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  toggle: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: radius.md, padding: 3, gap: 3, borderWidth: 1, borderColor: colors.line },
  opt: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: radius.sm },
  optPresent: { backgroundColor: colors.primary },
  optAbsent: { backgroundColor: colors.danger },
  optText: { fontSize: 12.5, fontWeight: '700', color: colors.textSoft },
}));
