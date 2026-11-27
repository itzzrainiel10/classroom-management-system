import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { ReviewModal } from '@/components/review-modal';
import { Button, Caption, Card, Field, H2, Label, Loading, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyRenewal, submitRenewal } from '@/lib/renewal';

/** Instructor → Confirm Status for the active semester (an administrator confirms it). */
export default function InstructorRenew() {
  const { data, loading, refresh } = useRemote('my-renewal', fetchMyRenewal);
  const [v, setV] = useState({ full_name: '', employee_id: '', department: '', contact_number: '', note: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!data || filled) return;
    const d = data.renewal?.details ?? {};
    setV({
      full_name: data.profile?.full_name ?? '',
      employee_id: d.employee_id || data.instructor?.employee_id || '',
      department: d.department || data.instructor?.department || '',
      contact_number: d.contact_number || data.instructor?.contact_number || '',
      note: d.note ?? '',
    });
    setFilled(true);
  }, [data, filled]);

  /** First step: check the form, then show every detail for review. */
  const review = () => {
    if (!v.full_name.trim()) return setErr('Enter your full name.');
    if (!confirmed) return setErr('Tick the box to confirm you are teaching this semester.');
    setErr(null);
    setReviewing(true);
  };

  /** Second step (from the review): send it to the administrator. */
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await submitRenewal({ ...v, full_name: v.full_name.trim() });
      await refresh();
      setReviewing(false);
      router.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data?.open) {
    return (
      <Screen>
        <Card>
          <H2>Nothing to confirm yet</H2>
          <Caption>This opens when the administrator starts the next semester. You’ll get a notification.</Caption>
        </Card>
      </Screen>
    );
  }
  if (data.renewal?.status === 'approved') {
    return (
      <Screen>
        <Card tone="soft" style={{ gap: 6 }}>
          <H2>You’re confirmed</H2>
          <Caption>
            {data.label}. Your subjects and sections appear once the administrator assigns them.
          </Caption>
        </Card>
      </Screen>
    );
  }

  return (
    <>
      <Screen>
        <Caption>
          Confirm your status for {data.label}. The administrator then assigns your subjects, sections and classes.
        </Caption>
        <Label>Your details</Label>
        <Card style={{ gap: 14 }}>
          <Field label="Full name" value={v.full_name} onChangeText={(t) => setV({ ...v, full_name: t })} autoComplete="name" />
          <Field label="Employee / faculty ID" value={v.employee_id} onChangeText={(t) => setV({ ...v, employee_id: t })} placeholder="CvSU-2019-0142" />
          <Field label="Department" value={v.department} onChangeText={(t) => setV({ ...v, department: t })} placeholder="Department of Information Technology" />
          <Field
            label="Note to the administrator (optional)"
            value={v.note}
            onChangeText={(t) => setV({ ...v, note: t })}
            placeholder="e.g. Available mornings only; prefers programming subjects"
            multiline
          />
        </Card>

        <Pressable onPress={() => setConfirmed((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Ionicons name={confirmed ? 'checkbox' : 'square-outline'} size={24} color={confirmed ? colors.primary : colors.muted} />
          <Text style={{ flex: 1, color: colors.text, fontSize: 14 }}>I’m teaching this semester and my details are correct.</Text>
        </Pressable>

        {err ? <Text style={{ color: colors.danger, fontWeight: '600' }}>{err}</Text> : null}
        <Button title={data.renewal?.status === 'rejected' ? 'Send again' : 'Confirm status'} icon="checkmark" onPress={review} />
      </Screen>
      <ReviewModal
        visible={reviewing}
        title="Check your details"
        rows={[
          ['Semester', data.label],
          ['Full name', v.full_name.trim()],
          ['Employee / faculty ID', v.employee_id.trim()],
          ['Department', v.department.trim()],
          ['Note to the administrator', v.note.trim()],
        ]}
        note="The administrator confirms your status, then assigns your subjects and sections."
        confirmLabel="Confirm & send"
        busy={busy}
        error={reviewing ? err : null}
        onEdit={() => {
          setReviewing(false);
          setErr(null);
        }}
        onConfirm={() => void submit()}
      />
    </>
  );
}
