import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Caption } from '@/components/ui';
import { colors, radius, shadow, themed } from '@/constants/theme';

/** "Check your details" sheet shown before a renewal is sent: every value, then Edit or Confirm. */
export function ReviewModal({
  visible,
  title,
  note,
  rows,
  confirmLabel,
  busy,
  error,
  onEdit,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  note?: string;
  rows: [string, string][];
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => undefined : onEdit} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.head}>
            <View style={styles.icon}>
              <Ionicons name="clipboard-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{title}</Text>
              <Caption>Check that everything is correct before sending.</Caption>
            </View>
          </View>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.list}>
            {rows.map(([label, value], i) => (
              <View key={label} style={[styles.row, i > 0 && styles.rowLine]}>
                <Text style={styles.label}>{label}</Text>
                <Text style={[styles.value, !value && styles.empty]}>{value || 'Not given'}</Text>
              </View>
            ))}
          </ScrollView>

          {note ? (
            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.noteText}>{note}</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={onEdit} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.edit, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}>
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
            <Button title={confirmLabel} icon="checkmark" onPress={onConfirm} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(10, 20, 15, 0.55)', justifyContent: 'center', padding: 20 },
    sheet: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 18, gap: 14, ...shadow.lg },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: 18, fontWeight: '800' },
    list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14 },
    row: { paddingVertical: 10, gap: 2 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    label: { color: colors.textSoft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    value: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
    empty: { color: colors.muted, fontWeight: '500', fontStyle: 'italic' },
    note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 10 },
    noteText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
    error: { color: colors.danger, fontWeight: '700' },
    actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    edit: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
    editText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  }),
);
