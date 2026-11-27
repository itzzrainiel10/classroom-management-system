import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ReviewModal } from '@/components/review-modal';
import { SectionPicker, useSections } from '@/components/section-picker';
import { Button, Caption, Card, Field, H2, Label, Loading, Screen, Segmented } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyRenewal, submitRenewal } from '@/lib/renewal';

/** Student → Renew Enrollment for the active semester (an administrator approves it). */
export default function StudentRenew() {
  const { data, loading, refresh } = useRemote('my-renewal', fetchMyRenewal);
  const { sections } = useSections();
  const [v, setV] = useState({ full_name: '', student_number: '', program: '', contact_number: '' });
  const [year, setYear] = useState<number>(1);
  const [section, setSection] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Start from what we already know (last request or profile).
  useEffect(() => {
    if (!data || filled) return;
    const r = data.renewal;
    setV({
      full_name: data.profile?.full_name ?? '',
      student_number: r?.details.student_number || data.profile?.student_number || '',
      program: r?.program ?? '',
      contact_number: r?.details.contact_number ?? '',
    });
    if (r?.year_level) setYear(r.year_level);
    if (r?.preferred_section_id) setSection(r.preferred_section_id);
    setFilled(true);
  }, [data, filled]);

  const programs = [...new Set((sections ?? []).map((s) => s.program).filter(Boolean))] as string[];
  const forYear = (sections ?? []).filter((s) => s.year_level === year && (!v.program || !s.program || s.program.toLowerCase() === v.program.trim().toLowerCase()));

  /** First step: check the form, then show every detail for review. */
  const review = () => {
    if (!v.full_name.trim()) return setErr('Enter your full name.');
    if (!v.program.trim()) return setErr('Enter your course / program.');
    if (!section) return setErr('Choose your section.');
    if (!confirmed) return setErr('Tick the box to confirm your details are correct.');
    setErr(null);
    setReviewing(true);
  };

  /** Second step (from the review): send it. */
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await submitRenewal({ ...v, full_name: v.full_name.trim(), program: v.program.trim(), year_level: year, section_id: section });
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
          <H2>Renewal isn’t open</H2>
          <Caption>It opens when the administrator starts the next semester. You’ll get a notification.</Caption>
        </Card>
      </Screen>
    );
  }
  if (data.renewal?.status === 'approved') {
    return (
      <Screen>
        <Card tone="soft" style={{ gap: 6 }}>
          <H2>You’re enrolled</H2>
          <Caption>
            {data.label}
            {data.renewal.assigned_section_name ? ` · ${data.renewal.assigned_section_name}` : ''}
          </Caption>
        </Card>
      </Screen>
    );
  }

  return (
    <>
      <Screen>
        <Caption>
          Renew your enrollment for {data.label}. Review your details and choose your section. You’re enrolled right away.
        </Caption>

        <Label>Personal information</Label>
        <Card style={{ gap: 14 }}>
          <Field label="Full name" value={v.full_name} onChangeText={(t) => setV({ ...v, full_name: t })} autoComplete="name" />
          <Field label="Student number" value={v.student_number} onChangeText={(t) => setV({ ...v, student_number: t })} placeholder="e.g. 2026-01428" />
        </Card>

        <Label>Enrollment details</Label>
        <Card style={{ gap: 14 }}>
          <Field label="Course / program" value={v.program} onChangeText={(t) => setV({ ...v, program: t })} placeholder="e.g. BSIT" autoCapitalize="characters" />
          {programs.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -6 }}>
              {programs.map((p) => (
                <Pressable key={p} onPress={() => setV({ ...v, program: p })} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primarySoft }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12.5 }}>{p}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Year level</Text>
            <Segmented<number>
              options={[1, 2, 3, 4, 5].map((y) => ({ label: `${y}`, value: y }))}
              value={year}
              onChange={(y) => {
                setYear(y);
                setSection(null);
              }}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Your section</Text>
            {forYear.length ? (
              <SectionPicker sections={forYear} value={section} onChange={setSection} />
            ) : (
              <Caption>No sections for year {year} yet. Check again later, or pick another year level.</Caption>
            )}
          </View>
        </Card>

        <Pressable onPress={() => setConfirmed((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Ionicons name={confirmed ? 'checkbox' : 'square-outline'} size={24} color={confirmed ? colors.primary : colors.muted} />
          <Text style={{ flex: 1, color: colors.text, fontSize: 14 }}>I confirm my course, year level and details are correct.</Text>
        </Pressable>

        {err ? <Text style={{ color: colors.danger, fontWeight: '600' }}>{err}</Text> : null}
        <Button title='Renew enrollment' icon="send" onPress={review} />
      </Screen>
      <ReviewModal
        visible={reviewing}
        title="Check your enrollment"
        rows={[
          ['Semester', data.label],
          ['Full name', v.full_name.trim()],
          ['Student number', v.student_number.trim()],
          ['Course / program', v.program.trim()],
          ['Year level', `Year ${year}`],
          ['Section', (sections ?? []).find((x) => x.id === section)?.name ?? ''],
        ]}
        note="When you confirm, you are enrolled in this section right away. Only an administrator can change it afterwards."
        confirmLabel="Confirm & renew"
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
