import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ClassPicker, defaultDue, DueDateField } from '@/components/pickers';
import { Button, Caption, Card, Field, Loading, Row, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useClasses } from '@/hooks/use-classes';
import { assignmentOp, fmtSize, MAX_ATTACHMENT_MB, uploadAssignmentFiles } from '@/lib/data';
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
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classId && classes?.length === 1 && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
    if (res.canceled) return;
    const big = res.assets.find((a) => (a.size ?? 0) > MAX_ATTACHMENT_MB * 1024 * 1024);
    if (big) return setError(`“${big.name}” is larger than ${MAX_ATTACHMENT_MB} MB.`);
    setError(null);
    setFiles([...files, ...res.assets]);
  };

  const submit = async () => {
    if (!classId) return setError('Choose a class.');
    if (!title.trim()) return setError('Give the assignment a title.');
    setBusy(true);
    setError(null);
    try {
      // Files go up first (needs internet); the assignment itself can still be queued offline.
      const id = Crypto.randomUUID();
      const attachments = files.length ? await uploadAssignmentFiles(classId, id, files) : [];
      const o = assignmentOp(classId, { title, description, due_at: due }, { id, attachments });
      await save(o.op, o.label);
      router.back();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : String(e)} Attachments need an internet connection.`);
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title={busy ? (files.length ? 'Uploading files…' : 'Posting…') : 'Post to class'} icon="send" onPress={submit} loading={busy} />}>
      <Caption>Share the next learning activity. Students see it in their class right away.</Caption>
      {classes ? <ClassPicker classes={classes} value={classId} onChange={setClassId} /> : <Loading />}
      <Field label="Assignment title" value={title} onChangeText={setTitle} placeholder="Build your first HTML page" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Create a page with a heading, paragraph, and a link. Submit your HTML document." multiline />
      <DueDateField value={due} onChange={setDue} />
      <Card tone="soft" style={{ gap: 8 }}>
        <Pressable onPress={pick} accessibilityRole="button" disabled={busy}>
          <Row>
            <Ionicons name="attach" size={18} color={colors.primary} />
            <Caption style={{ fontWeight: '800', color: colors.primary, flex: 1 }}>Attach files</Caption>
          </Row>
        </Pressable>
        <Caption>PDF, Word, PowerPoint, Excel, images or ZIP · up to {MAX_ATTACHMENT_MB} MB each.</Caption>
        {files.map((f, i) => (
          <Row key={`${f.uri}-${i}`} style={{ backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontWeight: '600', color: colors.text }}>
                {f.name}
              </Text>
              {f.size ? <Caption>{fmtSize(f.size)}</Caption> : null}
            </View>
            <Pressable onPress={() => setFiles(files.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`Remove ${f.name}`}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          </Row>
        ))}
      </Card>
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
    </Screen>
  );
}
