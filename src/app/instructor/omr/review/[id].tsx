import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Caption, Card, H2, Label, Loading, Pill, Row, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { fetchLayout, fetchScan, fetchSheets, finalizeScan, imageUrl, LETTERS, saveReview, STATUS_LABEL, type LayoutQuestion, type OmrScan, type OmrSheet } from '@/lib/omr';

const STATUS_TEXT: Record<string, string> = { answered: 'Read', blank: 'Blank', multiple: 'Multiple marks', uncertain: 'Unclear' };

/** Review a scanned sheet: fix unclear answers, choose the student, confirm & finalize. Same rules as the website. */
export default function OmrReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [scan, setScan] = useState<OmrScan | null>(null);
  const [layout, setLayout] = useState<LayoutQuestion[]>([]);
  const [sheets, setSheets] = useState<OmrSheet[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [pickStudent, setPickStudent] = useState(false);
  const [busy, setBusy] = useState<'save' | 'final' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchScan(id);
        if (!s) throw new Error('Scan not found');
        const [l, sh] = await Promise.all([fetchLayout(s.quiz_id), fetchSheets(s.quiz_id)]);
        setScan(s);
        setLayout(l);
        setSheets(sh);
        setAnswers(s.answers.length === l.length ? [...s.answers] : l.map(() => null));
        setSheetId(s.sheet_id);
        imageUrl(s.processed_path ?? s.image_path).then(setImg).catch(() => setImg(null));
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [id]);

  if (err && !scan) return <Screen><Caption style={{ color: colors.danger }}>{err}</Caption></Screen>;
  if (!scan) return <Screen><Loading /></Screen>;

  const done = scan.status === 'finalized';
  const unresolved = answers.filter((a) => a === null).length;
  const student = sheets.find((s) => s.id === sheetId);
  const canFinalize = !done && !unresolved && !!sheetId;

  const save = async () => {
    setBusy('save');
    setErr(null);
    try {
      const s = await saveReview(scan.id, answers, sheetId);
      setScan(s);
      return s;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    const s = await save();
    if (!s) return;
    setBusy('final');
    try {
      const f = await finalizeScan(scan.id);
      Alert.alert('Answer sheet graded', `${student?.student_name || student?.student_email || 'Student'}: ${f.score}/${f.total}. The student sees the score in the app.`);
      router.back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      footer={
        done ? undefined : (
          <View style={{ gap: 8 }}>
            {err ? <Caption style={{ color: colors.danger }}>{err}</Caption> : null}
            <Row>
              <Button title={busy === 'save' ? 'Saving…' : 'Save'} variant="secondary" style={{ flex: 1 }} onPress={() => void save()} disabled={!!busy} />
              <Button title={busy === 'final' ? 'Grading…' : 'Confirm & finalize'} icon="checkmark-done" style={{ flex: 2 }} onPress={() => void finalize()} disabled={!!busy || !canFinalize} />
            </Row>
            {!canFinalize ? <Caption style={{ textAlign: 'center' }}>{!sheetId ? 'Choose the student first.' : `${unresolved} answer(s) still need your decision.`}</Caption> : null}
          </View>
        )
      }>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pill label={STATUS_LABEL[scan.status].label} tone={STATUS_LABEL[scan.status].tone} />
        <Caption>{scan.source === 'mobile_camera' ? 'Phone camera' : 'Scanner'}{done ? ` · Score ${scan.score}/${scan.total}` : ''}</Caption>
      </Row>

      {img ? (
        <View style={styles.sheet}>
          <Image source={{ uri: img }} style={{ width: '100%', aspectRatio: 210 / 297 }} resizeMode="contain" />
          {scan.processed_path
            ? layout.map((q, i) => {
                const a = answers[i];
                if (a === null || a < 0) return null;
                const col = Math.floor(i / 25);
                const x = [34, 122][col] + a * 8;
                const y = 74 + (i % 25) * 8;
                return <View key={i} style={[styles.dot, { left: `${(x / 210) * 100}%`, top: `${(y / 297) * 100}%` }]} />;
              })
            : null}
        </View>
      ) : (
        <Loading />
      )}

      {scan.issues.filter((i) => !i.blocking).map((i) => (
        <Card key={i.code} tone="gold">
          <Caption style={{ color: colors.text }}>{i.message}</Caption>
        </Card>
      ))}

      <Label>Student</Label>
      <Pressable disabled={done} onPress={() => setPickStudent(!pickStudent)}>
        <Card style={[{ paddingVertical: 12 }, !sheetId && { borderColor: colors.danger }]}>
          <Row>
            <Ionicons name="person-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <H2>{student ? student.student_name || student.student_email : 'Choose the student'}</H2>
              {student ? <Caption>{student.student_email}</Caption> : <Caption>The QR code could not identify this sheet.</Caption>}
            </View>
            {!done ? <Ionicons name={pickStudent ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /> : null}
          </Row>
        </Card>
      </Pressable>
      {pickStudent
        ? sheets.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                setSheetId(s.id);
                setPickStudent(false);
              }}>
              <Card style={[{ paddingVertical: 10 }, s.id === sheetId && { borderColor: colors.primary }]}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{s.student_name || s.student_email}</Text>
                <Caption>{s.student_email}</Caption>
              </Card>
            </Pressable>
          ))
        : null}

      <Row style={{ justifyContent: 'space-between' }}>
        <Label>Answers</Label>
        {unresolved ? <Pill label={`${unresolved} to decide`} tone="gold" /> : <Pill label="All decided" tone="green" />}
      </Row>
      <Card style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
        {layout.map((q, i) => {
          const det = scan.detected[i];
          const a = answers[i];
          const set = (v: number) => setAnswers(answers.map((x, j) => (j === i ? v : x)));
          return (
            <View key={i} style={[styles.q, a === null && { backgroundColor: colors.goldSoft }, i === layout.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={styles.qn}>{i + 1}</Text>
              <View style={styles.opts}>
                {Array.from({ length: q.choices }, (_, c) => (
                  <Pressable key={c} disabled={done} onPress={() => set(c)} style={[styles.opt, a === c && styles.optOn]}>
                    <Text style={[styles.optText, a === c && { color: colors.onPrimary }]}>{q.type === 'true_false' ? (c === 0 ? 'T' : 'F') : LETTERS[c]}</Text>
                  </Pressable>
                ))}
                <Pressable disabled={done} onPress={() => set(-1)} style={[styles.opt, styles.blank, a === -1 && { backgroundColor: colors.textSoft, borderColor: colors.textSoft }]}>
                  <Text style={[styles.optText, a === -1 && { color: colors.onPrimary }]}>Blank</Text>
                </Pressable>
              </View>
              <Text style={[styles.st, det && (det.status === 'multiple' || det.status === 'uncertain') && { color: colors.goldInk, fontWeight: '800' }]}>
                {det ? STATUS_TEXT[det.status] : ''}
                {det?.status === 'answered' ? ` ${Math.round(det.confidence * 100)}%` : ''}
              </Text>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  sheet: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  dot: { position: 'absolute', width: '3.4%', aspectRatio: 1, marginLeft: '-1.7%', marginTop: '-1.7%', borderRadius: 999, borderWidth: 2, borderColor: '#1f7a4d' },
  q: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  qn: { width: 22, textAlign: 'right', fontWeight: '800', color: colors.textSoft, fontSize: 12.5 },
  opts: { flexDirection: 'row', gap: 4, flex: 1, flexWrap: 'wrap' },
  opt: { minWidth: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  optOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  blank: { paddingHorizontal: 8 },
  optText: { fontWeight: '800', color: colors.textSoft, fontSize: 12.5 },
  st: { fontSize: 11, color: colors.textSoft, width: 74, textAlign: 'right' },
}));
