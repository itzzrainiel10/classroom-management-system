import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroBackdrop, HeroTopBar } from '@/components/hero';
import { NoticeCard, useNotifications } from '@/components/notifications';
import { Button, Caption, Card, Field, Label, Screen } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { fetchMyApplication, submitApplication, uploadProof, type ApplicationRow } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';

/** Instructor application status. Pending/rejected instructors can only use this screen (the server enforces it too). */
export default function ApplicationScreen() {
  const { application, fullName, signOut, refreshAccount } = useAuth();
  const notices = useNotifications();
  const [row, setRow] = useState<ApplicationRow | null>(null);
  const [name, setName] = useState(fullName);
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');
  const [contact, setContact] = useState('');
  const [proof, setProof] = useState<{ uri: string; name: string; mimeType?: string | null } | null>(null);
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = async () => {
    try {
      const r = await fetchMyApplication();
      setRow(r);
      if (r) {
        setEmployeeId(r.employee_id);
        setDepartment(r.department);
        setContact(r.contact_number);
      }
    } catch {
      // offline: keep what's on screen
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => setName(fullName), [fullName]);

  const rejected = application?.status === 'rejected';
  const incomplete = !!row && (!row.employee_id || !row.department || !row.contact_number);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    if (a.size && a.size > 10 * 1024 * 1024) return setMessage({ text: 'That file is larger than 10 MB. Choose a smaller PDF or photo.', ok: false });
    setProof({ uri: a.uri, name: a.name, mimeType: a.mimeType });
  };

  const save = async () => {
    setBusy('save');
    setMessage(null);
    try {
      const path = proof ? await uploadProof(proof) : null;
      await submitApplication({ full_name: name, employee_id: employeeId, department, contact_number: contact, proof_path: path });
      setProof(null);
      await Promise.all([load(), refreshAccount()]);
      setMessage({ text: rejected ? 'Application sent again. An administrator will review it.' : 'Application saved. An administrator will review it.', ok: true });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not save. Check your connection and try again.', ok: false });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    await Promise.all([refreshAccount(), load(), notices.refresh()]);
    setBusy(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <Screen onRefresh={check}>
        <View style={styles.hero}>
          <HeroBackdrop />
          <HeroTopBar
            role="Instructor applicant"
            onSignOut={() =>
              Alert.alert('Log out?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Log out', style: 'destructive', onPress: signOut },
              ])
            }
          />
          <Text style={styles.title}>{rejected ? 'Application not approved' : 'Waiting for approval'}</Text>
          <Text style={styles.sub}>
            {rejected
              ? 'An administrator reviewed your instructor application. You can correct it and send it again.'
              : 'An administrator must verify that you are a CvSU instructor before the instructor dashboard opens.'}
          </Text>
          <View style={[styles.status, rejected ? styles.statusBad : styles.statusWait]}>
            <Ionicons name={rejected ? 'close-circle' : 'time'} size={18} color={rejected ? colors.danger : '#7A5F00'} />
            <Text style={[styles.statusText, { color: rejected ? colors.danger : '#7A5F00' }]}>{rejected ? 'Rejected' : 'Pending review'}</Text>
            {row?.submitted_at ? <Text style={styles.statusDate}>Sent {fmtDateTime(row.submitted_at)}</Text> : null}
          </View>
        </View>

        {rejected ? (
          <Card style={{ gap: 6, backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
            <Label style={{ color: colors.danger }}>Reason from the administrator</Label>
            <Text style={{ color: colors.text, fontSize: 15 }}>{application?.reason || 'No reason given.'}</Text>
            {row?.reviewed_at ? <Caption>Reviewed {fmtDateTime(row.reviewed_at)}</Caption> : null}
          </Card>
        ) : null}

        {incomplete ? (
          <Card tone="gold" style={{ gap: 4 }}>
            <Text style={{ fontWeight: '800', color: colors.text }}>Finish your application</Text>
            <Caption style={{ color: colors.text }}>Add your employee / faculty ID, department and contact number so an administrator can verify you.</Caption>
          </Card>
        ) : null}

        <Card style={{ gap: 14 }}>
          <Label>Your application</Label>
          <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Evelyn Morgan" autoComplete="name" />
          <Field label="Employee / Faculty ID" value={employeeId} onChangeText={setEmployeeId} placeholder="e.g. CvSU-2019-0142" autoCapitalize="characters" />
          <Field label="Department" value={department} onChangeText={setDepartment} placeholder="e.g. Department of Information Technology" />
          <Field label="Contact number" value={contact} onChangeText={setContact} placeholder="e.g. 0917 123 4567" keyboardType="phone-pad" autoComplete="tel" />
          <View style={{ gap: 6 }}>
            <Text style={styles.fieldLabel}>Proof of instructor identity (optional)</Text>
            <Caption>Faculty ID, appointment paper or certificate of employment. PDF or photo, up to 10 MB.</Caption>
            <Button
              title={proof ? proof.name : row?.proof_path ? 'Replace uploaded document' : 'Choose a file'}
              icon={proof || row?.proof_path ? 'document-attach' : 'cloud-upload-outline'}
              variant="secondary"
              small
              onPress={pick}
            />
            {row?.proof_path && !proof ? <Caption style={{ color: colors.primary }}>✓ A document is attached to your application.</Caption> : null}
          </View>
          {message ? (
            <View style={[styles.notice, { backgroundColor: message.ok ? colors.primarySoft : colors.dangerSoft }]}>
              <Text style={{ color: message.ok ? colors.primary : colors.danger, fontWeight: '600', flex: 1 }}>{message.text}</Text>
            </View>
          ) : null}
          <Button title={rejected ? 'Send application again' : 'Save application'} icon="send" onPress={save} loading={busy === 'save'} disabled={busy === 'check'} />
        </Card>

        <Button title="Check approval status" icon="refresh" variant="secondary" onPress={check} loading={busy === 'check'} />

        {notices.data?.length ? (
          <>
            <Label>Notifications</Label>
            {notices.data.slice(0, 5).map((n) => (
              <NoticeCard key={n.id} n={n} />
            ))}
          </>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, marginHorizontal: -20, marginTop: -20, padding: 20, paddingTop: 12, paddingBottom: 24, gap: 8, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden' },
  title: { color: colors.onPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  sub: { color: colors.onPrimarySoft, fontSize: 14, lineHeight: 20 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, marginTop: 6 },
  statusWait: { backgroundColor: colors.goldSoft },
  statusBad: { backgroundColor: colors.dangerSoft },
  statusText: { fontWeight: '800', fontSize: 13 },
  statusDate: { color: colors.textSoft, fontSize: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  notice: { flexDirection: 'row', padding: 12, borderRadius: radius.md },
});
