import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Label, Segmented } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { fmtDate, fmtTime, minutesToTime, timeToMinutes } from '@/lib/format';
import type { ClassRef } from '@/lib/data';

function Stepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityLabel="Previous" onPress={onPrev} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
      </Pressable>
      <Text style={styles.stepText}>{label}</Text>
      <Pressable accessibilityLabel="Next" onPress={onNext} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const TIMES = [
  { label: '8:00 AM', value: '08:00' },
  { label: '12:00 PM', value: '12:00' },
  { label: '5:00 PM', value: '17:00' },
  { label: '11:59 PM', value: '23:59' },
];

/** Due date: day stepper + common times. Value is an ISO string. */
export function DueDateField({ label = 'Due date', value, onChange }: { label?: string; value: string; onChange: (iso: string) => void }) {
  const d = new Date(value);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const shift = (days: number) => {
    const n = new Date(d);
    n.setDate(n.getDate() + days);
    onChange(n.toISOString());
  };
  const setTime = (t: string) => {
    const [h = 0, m = 0] = t.split(':').map(Number);
    const n = new Date(d);
    n.setHours(h, m, 0, 0);
    onChange(n.toISOString());
  };
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <Stepper label={fmtDate(value)} onPrev={() => shift(-1)} onNext={() => shift(1)} />
      <Segmented options={TIMES} value={TIMES.some((t) => t.value === hhmm) ? hhmm : ''} onChange={setTime} />
    </View>
  );
}

export function defaultDue(daysAhead = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

/** Time of day in 30-minute steps. Value like "09:00:00". */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  const m = timeToMinutes(value);
  return (
    <View style={{ gap: 8, flex: 1 }}>
      <Label>{label}</Label>
      <Stepper label={fmtTime(value)} onPrev={() => onChange(minutesToTime((m - 30 + 1440) % 1440))} onNext={() => onChange(minutesToTime((m + 30) % 1440))} />
    </View>
  );
}

export function NumberField({ label, value, onChange, step = 1, min = 0, max = 999, suffix = '' }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <View style={{ gap: 8, flex: 1 }}>
      <Label>{label}</Label>
      <Stepper label={`${value}${suffix}`} onPrev={() => onChange(Math.max(min, value - step))} onNext={() => onChange(Math.min(max, value + step))} />
    </View>
  );
}

/** Pick one of the instructor's classes. */
export function ClassPicker({ classes, value, onChange }: { classes: (ClassRef & { id: string })[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Label>Class / Section</Label>
      <View style={{ gap: 8 }}>
        {classes.map((c) => {
          const active = c.id === value;
          return (
            <Pressable key={c.id} onPress={() => onChange(c.id)} style={[styles.classOpt, active && styles.classOptActive]}>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? colors.primary : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.classCode}>
                  {c.code} · {c.section}
                </Text>
                <Text style={styles.classTitle}>{c.title}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 6,
    minHeight: 50,
  },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  stepText: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text },
  classOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  classOptActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  classCode: { fontSize: 15, fontWeight: '800', color: colors.text },
  classTitle: { fontSize: 13, color: colors.textSoft },
}));
