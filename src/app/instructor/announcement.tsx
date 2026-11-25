import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ClassPicker } from '@/components/pickers';
import { Body, Button, Caption, Card, Field, H2, Label, Loading, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { useRemote } from '@/hooks/use-remote';
import { announcementOp, fetchFeed } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';

export default function PostAnnouncement() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { data: classes } = useClasses();
  const { data: feed } = useRemote('feed', fetchFeed);
  const { save } = useOutbox();
  const [classId, setClassId] = useState<string | null>(params.classId ?? null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classId && classes?.length === 1 && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const submit = async () => {
    if (!classId) return setError('Choose a class.');
    if (!title.trim() || !message.trim()) return setError('Add a title and a message.');
    const o = announcementOp(classId, { title, message });
    await save(o.op, o.label);
    router.back();
  };

  const recent = feed?.announcements[0];

  return (
    <Screen footer={<Button title="Post announcement" icon="megaphone" onPress={submit} />}>
      <Caption>Keep your class in the loop. Share updates with your class.</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Field label="Announcement title" value={title} onChangeText={setTitle} placeholder="HTML Basics quiz reminder" />
      <Field label="Message" value={message} onChangeText={setMessage} placeholder="The quiz opens on November 05. You will have 30 minutes to answer 10 questions." multiline />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      {recent ? (
        <>
          <Label>Recent announcement</Label>
          <Card style={{ gap: 4 }}>
            <H2>{recent.title}</H2>
            <Body>{recent.message}</Body>
            <Caption>
              {recent.class?.code} · {recent.class?.section} · Posted {fmtDate(recent.created_at)} · Visible to students
            </Caption>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
