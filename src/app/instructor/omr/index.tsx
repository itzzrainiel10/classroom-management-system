import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Caption, Card, Empty, H2, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { fetchLayout, fetchOmrExams, fetchScans, fetchSheets, omrQueue, STATUS_LABEL, uploadAndProcess, type OmrExam, type OmrScan, type OmrSheet, type QueueItem } from '@/lib/omr';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** OMR Scanner (mobile): pick an exam → capture sheets with the camera → upload → review results. */
export default function OmrScanner() {
  const [exams, setExams] = useState<OmrExam[] | null>(null);
  const [examId, setExamId] = useState<string | null>(null);
  const [layoutErr, setLayoutErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [scans, setScans] = useState<OmrScan[] | null>(null);
  const [sheets, setSheets] = useState<OmrSheet[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>(omrQueue.get());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => omrQueue.subscribe(setQueue), []);
  useEffect(() => {
    fetchOmrExams()
      .then((e) => {
        setExams(e);
        if (e.length && !examId) setExamId(e[0].id);
      })
      .catch((e) => setErr(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exam = exams?.find((e) => e.id === examId) ?? null;

  const load = useCallback(async () => {
    if (!examId) return;
    try {
      const [l, s, sh] = await Promise.allSettled([fetchLayout(examId), fetchScans(examId), fetchSheets(examId)]);
      setLayoutErr(l.status === 'rejected' ? String((l.reason as Error).message) : null);
      setCount(l.status === 'fulfilled' ? l.value.length : 0);
      if (s.status === 'fulfilled') setScans(s.value);
      if (sh.status === 'fulfilled') setSheets(sh.value);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }, [examId]);

  useEffect(() => {
    setScans(null);
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const mine = queue.filter((q) => q.examId === examId);
  const pending = mine.filter((q) => q.state === 'waiting' || q.state === 'error');

  const uploadAll = async () => {
    if (!exam) return;
    setBusy(true);
    setErr(null);
    for (const it of pending) {
      try {
        const scan = await uploadAndProcess(exam, it.uri, (s) => omrQueue.update(it.key, { state: s, error: undefined }));
        omrQueue.update(it.key, { state: 'done', scan });
      } catch (e) {
        omrQueue.update(it.key, { state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    await load();
  };

  const sheetName = (id: string | null) => {
    const s = sheets.find((x) => x.id === id);
    return s ? s.student_name || s.student_email : 'Student not identified';
  };

  if (!exams) return <Screen>{err ? <Caption style={{ color: colors.danger }}>{err}</Caption> : <Loading />}</Screen>;

  return (
    <Screen onRefresh={load}>
      <Caption>Photograph printed answer sheets. They are read by the same engine as scanner uploads on the Instructor website, then you review and finalize.</Caption>
      {!exams.length ? <Empty icon="document-text-outline" title="No exams yet" body="Create a multiple-choice or True/False quiz first." /> : null}

      {exams.length ? (
        <>
          <Label>Examination</Label>
          <View style={{ gap: 8 }}>
            {exams.map((e) => (
              <Pressable key={e.id} onPress={() => setExamId(e.id)}>
                <Card style={[{ paddingVertical: 12 }, e.id === examId && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
                  <Row>
                    <Ionicons name={e.id === examId ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <H2 numberOfLines={1}>{e.title}</H2>
                      <Caption>{e.class ? `${e.class.code} · ${e.class.section}` : ''}</Caption>
                    </View>
                  </Row>
                </Card>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {exam && layoutErr ? (
        <Card tone="gold" style={{ gap: 4 }}>
          <H2>This exam can’t be done on paper</H2>
          <Caption style={{ color: colors.text }}>{layoutErr}</Caption>
        </Card>
      ) : null}

      {exam && !layoutErr ? (
        <>
          <Card style={{ gap: 10 }}>
            <Row>
              <Ionicons name="scan-outline" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <H2>Scan answer sheets</H2>
                <Caption>
                  {count} questions · print sheets from the Instructor website (OMR Management) first
                </Caption>
              </View>
            </Row>
            <Button title="Open camera" icon="camera" onPress={() => router.push({ pathname: '/instructor/omr/camera', params: { examId: exam.id, title: exam.title } })} />
          </Card>

          {mine.length ? (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <Label>Scan queue ({mine.length})</Label>
                {mine.some((q) => q.state === 'done') ? (
                  <Pressable onPress={() => omrQueue.clearDone()} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Clear finished</Text>
                  </Pressable>
                ) : null}
              </Row>
              {mine.map((q) => (
                <Card key={q.key} style={{ paddingVertical: 10 }}>
                  <Row>
                    <Image source={{ uri: q.uri }} style={styles.thumb} />
                    <View style={{ flex: 1, gap: 3 }}>
                      {q.state === 'waiting' ? <Pill label="Waiting to upload" /> : null}
                      {q.state === 'uploading' || q.state === 'processing' ? (
                        <Row style={{ gap: 6 }}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Caption>{q.state === 'uploading' ? 'Uploading…' : 'Reading bubbles…'}</Caption>
                        </Row>
                      ) : null}
                      {q.state === 'error' ? <Pill label="Error" tone="red" /> : null}
                      {q.scan ? <Pill label={STATUS_LABEL[q.scan.status].label} tone={STATUS_LABEL[q.scan.status].tone} /> : null}
                      {q.error || (q.scan && (q.scan.status === 'failed' || q.scan.status === 'duplicate')) ? (
                        <Caption style={{ color: colors.danger }}>{q.error ?? q.scan?.message}</Caption>
                      ) : null}
                      {q.scan && (q.scan.status === 'needs_review' || q.scan.status === 'ready') ? <Caption>{sheetName(q.scan.sheet_id)}</Caption> : null}
                    </View>
                    {q.state === 'waiting' || q.state === 'error' ? (
                      <Pressable onPress={() => omrQueue.remove(q.key)} hitSlop={8} accessibilityLabel="Remove photo">
                        <Ionicons name="close-circle" size={22} color={colors.muted} />
                      </Pressable>
                    ) : null}
                    {q.scan && (q.scan.status === 'needs_review' || q.scan.status === 'ready') ? (
                      <Pressable onPress={() => router.push(`/instructor/omr/review/${q.scan!.id}`)} hitSlop={8} accessibilityLabel="Review">
                        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
                      </Pressable>
                    ) : null}
                  </Row>
                </Card>
              ))}
              {pending.length ? <Button title={busy ? 'Uploading…' : `Upload & read ${pending.length} sheet(s)`} icon="cloud-upload-outline" onPress={uploadAll} loading={busy} /> : null}
            </>
          ) : null}

          {err ? <Caption style={{ color: colors.danger }}>{err}</Caption> : null}

          <Label>Results for this exam</Label>
          {!scans ? <Loading /> : null}
          {scans && !scans.length ? <Caption>No scans yet. Scanner uploads from the website appear here too.</Caption> : null}
          {scans?.map((s) => {
            const st = STATUS_LABEL[s.status];
            const open = s.status === 'needs_review' || s.status === 'ready' || s.status === 'finalized';
            return (
              <Pressable key={s.id} disabled={!open} onPress={() => router.push(`/instructor/omr/review/${s.id}`)}>
                <Card style={{ paddingVertical: 10 }}>
                  <Row>
                    <Ionicons name={s.source === 'mobile_camera' ? 'phone-portrait-outline' : 'print-outline'} size={18} color={colors.textSoft} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {sheetName(s.sheet_id)}
                      </Text>
                      <Caption>
                        {fmtTime(s.created_at)}
                        {s.status === 'finalized' ? ` · Score ${s.score}/${s.total}` : ''}
                      </Caption>
                      {s.status === 'failed' || s.status === 'duplicate' ? <Caption style={{ color: colors.danger }}>{s.message}</Caption> : null}
                    </View>
                    <Pill label={st.label} tone={st.tone} />
                    {open ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
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

const styles = StyleSheet.create({
  thumb: { width: 46, height: 64, borderRadius: radius.sm, backgroundColor: colors.line },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.text },
});
