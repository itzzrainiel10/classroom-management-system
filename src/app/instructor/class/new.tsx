import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Caption, Field, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { newClassOp } from '@/lib/data';
import { useOutbox } from '@/lib/outbox';

export default function NewClass() {
  const { userId } = useAuth();
  const { save } = useOutbox();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !title.trim() || !section.trim()) return setError('Fill in the course code, title and section.');
    if (!userId) return;
    setBusy(true);
    const o = newClassOp(userId, { code, title, section, description });
    await save(o.op, o.label);
    router.replace(`/instructor/class/${o.id}`);
  };

  return (
    <Screen>
      <Field label="Course code" value={code} onChangeText={setCode} placeholder="ITEC 116" autoCapitalize="characters" autoFocus />
      <Field label="Course title" value={title} onChangeText={setTitle} placeholder="Web Development" />
      <Field label="Section" value={section} onChangeText={setSection} placeholder="Dash 3" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Optional" multiline />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      <Button title="Create class" icon="checkmark" onPress={submit} loading={busy} />
    </Screen>
  );
}
