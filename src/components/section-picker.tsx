import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Caption, Card, H2 } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { chooseMySection, fetchSections, type SectionOption } from '@/lib/data';

/** Loads the section list (works before sign-in). */
export function useSections() {
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetchSections()
      .then(setSections)
      .catch(() => setError(true));
  }, []);
  return { sections, error };
}

/** Sections grouped by year level, as tappable chips. */
export function SectionPicker({ sections, value, onChange }: { sections: SectionOption[]; value: string | null; onChange: (id: string) => void }) {
  const years = [...new Set(sections.map((s) => s.year_level))].sort();
  return (
    <View style={{ gap: 10 }}>
      {years.map((y) => (
        <View key={y} style={{ gap: 6 }}>
          <Text style={styles.year}>YEAR {y}</Text>
          <View style={styles.wrap}>
            {sections
              .filter((s) => s.year_level === y)
              .map((s) => {
                const on = value === s.id;
                return (
                  <Pressable key={s.id} onPress={() => onChange(s.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && { color: colors.onPrimary }]}>{s.name}</Text>
                  </Pressable>
                );
              })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Shown to a signed-in student who has no section yet: pick it once. */
export function ChooseSectionCard({ onChosen }: { onChosen: () => void }) {
  const { sections, error } = useSections();
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = sections?.find((s) => s.id === value);

  const save = () => {
    if (!picked) return;
    Alert.alert(`Join ${picked.name}?`, 'You can choose only once. After this, only your administrator can change your section.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Join section',
        onPress: async () => {
          setBusy(true);
          try {
            await chooseMySection(picked.id);
            onChosen();
          } catch (e) {
            Alert.alert('Could not save', e instanceof Error ? e.message : 'Check your connection and try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Card tone="gold" style={{ gap: 10 }}>
      <H2>Choose your section</H2>
      <Caption style={{ color: colors.text }}>Pick the section you belong to so you can see its class schedule and instructors.</Caption>
      {error ? <Caption style={{ color: colors.danger }}>Couldn’t load sections. Pull down to try again.</Caption> : null}
      {sections && !sections.length ? <Caption>No sections have been set up yet. Ask your administrator.</Caption> : null}
      {sections?.length ? <SectionPicker sections={sections} value={value} onChange={setValue} /> : null}
      {sections?.length ? <Button title={picked ? `Join ${picked.name}` : 'Select a section'} icon="checkmark" onPress={save} disabled={!picked} loading={busy} /> : null}
    </Card>
  );
}


const styles = StyleSheet.create({
  year: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.muted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: '700', color: colors.text },
});
