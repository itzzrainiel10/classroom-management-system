import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';

import { AnnouncementCard } from '@/components/announcement-card';
import { Body, Button, Caption, Card, Empty, Field, H1, H2, Label, ListCard, ListItem, Loading, OfflineNote, Pill, QuizStatusPill, Row, Screen, Segmented } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { useAuth } from '@/lib/auth';
import { addStudentOp, deleteOp, fetchClassDetail, removeStudentOp, type Student } from '@/lib/data';
import { dayName, fmtDate, fmtDateTime, fmtTime } from '@/lib/format';
import { pendingDeletes, pendingRows } from '@/lib/offline';
import { useOutbox } from '@/lib/outbox';

type Detail = Awaited<ReturnType<typeof fetchClassDetail>>;

export default function ManageClass() {
  const { id, tab: requestedTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { save } = useOutbox();
  const { fullName } = useAuth();
  const [tab, setTab] = useState<'students' | 'activities' | 'announcements' | 'settings'>('announcements');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    if (requestedTab === 'announcements') setTab('announcements');
  }, [id, requestedTab]);

  const { data, loading, offline, savedAt, refresh } = useRemote<Detail>(`class:${id}`, () => fetchClassDetail(id), async (d) => {
    const [pStudents, gone] = await Promise.all([pendingRows<Student>('class_students'), pendingDeletes('class_students')]);
    const mine = pStudents.filter((s) => s.class_id === id && !d.students.some((x) => x.id === s.id));
    return { ...d, students: [...d.students, ...mine].filter((s) => !gone.has(s.id)) };
  });

  if (loading && !data) return <Loading />;
  if (!data?.cls) {
    return (
      <Screen>
        <OfflineNote show={offline} savedAt={savedAt} />
        <Empty icon="alert-circle-outline" title="Class not found" body="It may still be uploading. Pull down to refresh once you're online." />
      </Screen>
    );
  }
  const cls = data.cls;
  const students = data.students.filter((s) => `${s.full_name} ${s.email}`.toLowerCase().includes(search.trim().toLowerCase()));

  const addStudent = async () => {
    if (!email.includes('@')) return setFormError('Enter the student’s email.');
    if (data.students.some((s) => s.email === email.trim().toLowerCase())) return setFormError('That student is already in this class.');
    const o = addStudentOp(cls.id, email, name);
    setEmail('');
    setName('');
    setFormError(null);
    setAdding(false);
    await save(o.op, o.label);
  };

  const removeStudent = (s: Student) =>
    Alert.alert(`Remove ${s.full_name || s.email}?`, 'They will lose access to this class.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { const o = removeStudentOp(s.id, s.email); save(o.op, o.label); } },
    ]);

  const deleteClass = () =>
    Alert.alert(`Delete ${cls.code} · ${cls.section}?`, 'This removes its students, quizzes, results, assignments and announcements.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const o = deleteOp('classes', cls.id, `Delete class ${cls.code}`);
          await save(o.op, o.label);
          router.back();
        },
      },
    ]);

  return (
    <Screen onRefresh={refresh}>
      <Stack.Screen options={{ title: `${cls.code} · ${cls.section}` }} />
      <View style={{ gap: 4 }}>
        <H1>{cls.code}</H1>
        <Caption>
          {cls.title} · Section {cls.section} · {data.students.length} enrolled
        </Caption>
      </View>
      <OfflineNote show={offline} savedAt={savedAt} />
      <Segmented
        options={[
          { label: 'Students', value: 'students' as const },
          { label: 'Announcements', value: 'announcements' as const },
          { label: 'Activities', value: 'activities' as const },
          { label: 'Settings', value: 'settings' as const },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'students' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: 12 }}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search students…" placeholderTextColor={colors.muted} style={{ flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text }} />
          </View>
          {adding ? (
            <Card style={{ gap: 12 }}>
              <Field label="Student email" value={email} onChangeText={setEmail} placeholder="student@cvsu.edu.ph" autoCapitalize="none" keyboardType="email-address" autoFocus />
              <Field label="Full name (Last, First)" value={name} onChangeText={setName} placeholder="Reyes, Ana" />
              {formError ? <Caption style={{ color: colors.danger }}>{formError}</Caption> : null}
              <Row>
                <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setAdding(false)} />
                <Button title="Add student" style={{ flex: 1 }} onPress={addStudent} />
              </Row>
            </Card>
          ) : (
            <Button title="Add student" icon="person-add" variant="secondary" onPress={() => setAdding(true)} />
          )}
          {students.length === 0 ? (
            <Empty icon="people-outline" title={search ? 'No match' : 'No students yet'} body="Add students by their CvSU email. They’ll see this class once they log in with that email." />
          ) : (
            <ListCard>
              {students.map((s, i) => (
                <ListItem
                  key={s.id}
                  title={s.full_name || s.email}
                  subtitle={s.full_name ? s.email : undefined}
                  last={i === students.length - 1}
                  right={
                    <Row style={{ gap: 10 }}>
                      <Pill label={s._pending ? 'Waiting' : 'Active'} tone={s._pending ? 'gold' : 'green'} />
                      <Pressable onPress={() => removeStudent(s)} hitSlop={8} accessibilityLabel="Remove student">
                        <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
                      </Pressable>
                    </Row>
                  }
                />
              ))}
            </ListCard>
          )}
        </>
      ) : null}

      {tab === 'activities' ? (
        <>
          <Row>
            <Button title="Quiz" icon="add" small style={{ flex: 1 }} onPress={() => router.push({ pathname: '/instructor/quiz/new', params: { classId: cls.id } })} />
            <Button title="Assignment" icon="add" small variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/instructor/assignment', params: { classId: cls.id } })} />
          </Row>
          <Label>Quizzes</Label>
          {data.quizzes.length ? (
            <ListCard>
              {data.quizzes.map((q, i) => (
                <ListItem
                  key={q.id}
                  icon="create-outline"
                  title={q.title}
                  subtitle={`${q.questions} questions · ${q.submitted} of ${data.students.length} submitted · Due ${fmtDate(q.due_at)}`}
                  right={<QuizStatusPill status={q.status} kind={q.kind} />}
                  last={i === data.quizzes.length - 1}
                  onPress={() => router.push(`/instructor/quiz/${q.id}`)}
                />
              ))}
            </ListCard>
          ) : (
            <Caption>No quizzes yet.</Caption>
          )}
          <Label>Assignments</Label>
          {data.assignments.length ? (
            <ListCard>
              {data.assignments.map((a, i) => (
                <ListItem key={a.id} icon="document-attach-outline" title={a.title} subtitle={`Due ${fmtDateTime(a.due_at)}${a.attachments?.length ? ` · ${a.attachments.length} file${a.attachments.length === 1 ? '' : 's'}` : ''}`} last={i === data.assignments.length - 1} />
              ))}
            </ListCard>
          ) : (
            <Caption>No assignments yet.</Caption>
          )}
        </>
      ) : null}

      {tab === 'announcements' ? (
        <>
          <Label>Announcements · {cls.section}</Label>
          {data.announcements.length ? (
            data.announcements.map((a, index) => (
              <AnnouncementCard key={a.id} a={a} fallbackName={fullName || 'You'} discussionInitiallyOpen={index === 0} />
            ))
          ) : (
            <Empty icon="megaphone-outline" title="No announcements yet" body="Announcements posted for this section will appear here." />
          )}
        </>
      ) : null}

      {tab === 'settings' ? (
        <>
          <Card style={{ gap: 6 }}>
            <Label>Class details</Label>
            <H2>
              {cls.code} · {cls.title}
            </H2>
            <Caption>Section {cls.section}</Caption>
            {cls.description ? <Body>{cls.description}</Body> : null}
          </Card>
          <Card style={{ gap: 8 }}>
            <Label>Meets</Label>
            {data.schedules.length ? (
              data.schedules.map((s) => (
                <Caption key={s.id}>
                  {dayName(s.day_of_week)} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                  {s.room ? ` · ${s.room}` : ''}
                </Caption>
              ))
            ) : (
              <Caption>No schedule yet.</Caption>
            )}
            <Button title="Add schedule" icon="calendar" small variant="secondary" onPress={() => router.push({ pathname: '/instructor/schedule-new', params: { classId: cls.id } })} />
          </Card>
          {cls.subject_id ? (
            // Classes from the official schedule stay until the administrator removes the schedule,
            // so this app and the website always list the same classes.
            <Caption style={{ textAlign: 'center' }}>This class comes from the official schedule. To remove it, ask the administrator to delete its schedule.</Caption>
          ) : (
            <Button title="Delete class" icon="trash-outline" variant="danger" onPress={deleteClass} />
          )}
        </>
      ) : null}
    </Screen>
  );
}
