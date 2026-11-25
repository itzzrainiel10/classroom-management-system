import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ClassPicker, defaultDue, DueDateField } from '@/components/pickers';
import { Button, Caption, Card, Field, Loading, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { assignmentOp } from '@/lib/data';
import { useOutbox } from '@/lib/outbox';

export default function PostAssignment() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { data: classes } = useClasses();
  const { save } = useOutbox();
  const [classId, setClassId] = useState<string | null>(params.classId ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState(defaultDue(7));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classId && classes?.length === 1 && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const submit = async () => {
    if (!classId) return setError('Choose a class.');
    if (!title.trim()) return setError('Give the assignment a title.');
    const o = assignmentOp(classId, { title, description, due_at: due });
    await save(o.op, o.label);
    router.back();
  };

  return (
    <Screen footer={<Button title="Post to class" icon="send" onPress={submit} />}>
      <Caption>Share the next learning activity. Students see it in their class right away.</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Field label="Assignment title" value={title} onChangeText={setTitle} placeholder="Build your first HTML page" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Create a page with a heading, paragraph, and a link. Submit your HTML document." multiline />
      <DueDateField value={due} onChange={setDue} />
      <Card tone="soft" style={{ gap: 2 }}>
        <Caption style={{ fontWeight: '800', color: colors.primary }}>+ Attach files</Caption>
        <Caption>Coming soon — PDF, DOCX or images up to 10 MB.</Caption>
      </Card>
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
    </Screen>
  );
}
