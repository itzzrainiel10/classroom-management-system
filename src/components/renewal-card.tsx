import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Caption, Card, H2 } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useRemote } from '@/hooks/use-remote';
import { fetchMyRenewal } from '@/lib/renewal';
import { fmtDate } from '@/lib/format';

/** Home-screen card: renew for the active semester, or see where the request stands. Hidden once approved. */
export function RenewalCard({ role }: { role: 'student' | 'instructor' }) {
  const { data } = useRemote('my-renewal', fetchMyRenewal);
  if (!data?.open || data.renewal?.status === 'approved') return null;
  const r = data.renewal;
  const term = data.label;
  const go = () => router.push(`/${role}/renew` as Href);
  const action = role === 'student' ? 'Renew Enrollment' : 'Confirm Status';

  if (r?.status === 'pending') {
    return (
      <Card tone="gold" style={styles.card}>
        <View style={styles.head}>
          <Ionicons name="time-outline" size={22} color={colors.goldInk} />
          <H2 style={{ flex: 1 }}>{role === 'student' ? 'Renewal sent' : 'Status sent'}</H2>
        </View>
        <Caption style={{ color: colors.text }}>
          Waiting for the administrator to approve your {role === 'student' ? 'enrollment' : 'teaching status'} for {term}
          {r.submitted_at ? ` (sent ${fmtDate(r.submitted_at)})` : ''}.
          {role === 'student' && r.preferred_section_name ? ` Requested section: ${r.preferred_section_name}.` : ''}
        </Caption>
        <Button title="Edit and send again" variant="secondary" small onPress={go} />
      </Card>
    );
  }

  if (r?.status === 'rejected') {
    return (
      <Card style={[styles.card, { borderColor: colors.danger }]}>
        <View style={styles.head}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
          <H2 style={{ flex: 1 }}>Renewal not approved</H2>
        </View>
        {r.reason ? <Text style={styles.reason}>Reason: {r.reason}</Text> : null}
        <Caption>Fix your details and send it again.</Caption>
        <Button title={action} icon="refresh" onPress={go} />
      </Card>
    );
  }

  return (
    <Card style={[styles.card, styles.open]}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="school" size={20} color={colors.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <H2>{role === 'student' ? 'Renew your enrollment' : 'Confirm your teaching status'}</H2>
          <Caption>{data.semester ? `${term} has started.` : 'Renewal for the next semester is open.'}</Caption>
        </View>
      </View>
      <Caption style={{ color: colors.text }}>
        {role === 'student'
          ? 'Confirm your course, year level and section. You’re enrolled right away.'
          : 'Update your details so the administrator can assign your subjects and sections for this semester.'}
      </Caption>
      <Button title={action} icon="arrow-forward" onPress={go} />
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: { gap: 10 },
    open: { borderColor: colors.primary, borderWidth: 1.5 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    reason: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  }),
);
