import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { AnnouncementCard } from '@/components/announcement-card';
import { ClassPicker } from '@/components/pickers';
import { Button, Caption, Empty, Field, Label, Loading, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { useRemote } from '@/hooks/use-remote';
import { announcementOp, fetchFeed } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useOutbox } from '@/lib/outbox';

export default function PostAnnouncement() {
  const params = useLocalSearchParams<{ classId?: string }>();
  const { data: classes } = useClasses();
  const { data: feed, loading: feedLoading, error: feedError } = useRemote('feed', fetchFeed);
  const { fullName } = useAuth();
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

  const announcements = classId ? (feed?.announcements ?? []).filter((a) => a.class_id === classId) : [];

  return (
    <Screen footer={<Button title="Post announcement" icon="megaphone" onPress={submit} />}>
      <Caption>Keep your class in the loop. Share updates with your class.</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Field label="Announcement title" value={title} onChangeText={setTitle} placeholder="HTML Basics quiz reminder" />
      <Field label="Message" value={message} onChangeText={setMessage} placeholder="The quiz opens on November 05. You will have 30 minutes to answer 10 questions." multiline />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      {feedError && !feed ? <Caption style={{ color: colors.danger }}>{feedError}</Caption> : null}
      {classId && feedLoading && !feed ? <Loading /> : null}
      {announcements.length ? (
        <>
          <Label>Class announcements · Messages</Label>
          {announcements.map((announcement, index) => (
            <AnnouncementCard
              key={announcement.id}
              a={announcement}
              classLabel={announcement.class ? `${announcement.class.code} · ${announcement.class.section}` : undefined}
              fallbackName={fullName || 'You'}
              discussionInitiallyOpen={index === 0}
            />
          ))}
        </>
      ) : classId && feed ? (
        <Empty
          icon="megaphone-outline"
          title="No announcements for this section yet"
          body="Announcements posted to this class and section will appear here."
        />
      ) : null}
    </Screen>
  );
}
