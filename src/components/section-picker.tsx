import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Caption, Card, H2 } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
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

/** A compact, scrollable section dropdown for sign-up. */
export function SectionDropdown({ sections, value, onChange }: { sections: SectionOption[]; value: string | null; onChange: (id: string | null) => void }) {
  const selected = sections.find((s) => s.id === value);
  const years = [...new Set(sections.map((s) => s.year_level))].sort((a, b) => a - b);
  const [year, setYear] = useState<number | null>(selected?.year_level ?? null);
  const [yearOpen, setYearOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const yearSections = year === null ? [] : sections.filter((s) => s.year_level === year);

  useEffect(() => {
    if (selected) setYear(selected.year_level);
  }, [selected?.id]);

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.dropdownLabel}>Year level</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={year === null ? 'Select a year level' : `Year ${year}`}
        accessibilityState={{ expanded: yearOpen }}
        onPress={() => {
          setYearOpen((v) => !v);
          setSectionOpen(false);
        }}
        style={styles.dropdownTrigger}>
        <Text style={[styles.dropdownValue, year === null && styles.dropdownPlaceholder]}>{year === null ? 'Select a year' : `Year ${year}`}</Text>
        <Ionicons name={yearOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSoft} />
      </Pressable>
      {yearOpen ? (
        <ScrollView style={styles.dropdownList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {years.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: option === year }}
              onPress={() => {
                setYear(option);
                if (selected?.year_level !== option) onChange(null);
                setYearOpen(false);
              }}
              style={[styles.dropdownOption, option === year && styles.dropdownOptionActive]}>
              <Text style={styles.dropdownName}>Year {option}</Text>
              {option === year ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Text style={styles.dropdownLabel}>Section</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `Section: ${selected.name}` : year === null ? 'Choose a year first' : 'Select a section'}
        accessibilityState={{ disabled: year === null, expanded: sectionOpen }}
        disabled={year === null}
        onPress={() => {
          setSectionOpen((v) => !v);
          setYearOpen(false);
        }}
        style={[styles.dropdownTrigger, year === null && styles.dropdownDisabled]}>
        <Text style={[styles.dropdownValue, !selected && styles.dropdownPlaceholder]}>{selected?.name ?? (year === null ? 'Choose a year first' : 'Select a section')}</Text>
        <Ionicons name={sectionOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSoft} />
      </Pressable>
      {sectionOpen ? (
        <ScrollView style={styles.dropdownList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {yearSections.map((s) => {
            const active = s.id === value;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(s.id);
                  setSectionOpen(false);
                }}
                style={[styles.dropdownOption, active && styles.dropdownOptionActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownName}>{s.name}</Text>
                  {s.program ? <Text style={styles.dropdownDetail}>{s.program}</Text> : null}
                </View>
                {active ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** A section-only dropdown for forms that already collect year level separately. */
export function SectionSelect({ sections, value, onChange }: { sections: SectionOption[]; value: string | null; onChange: (id: string) => void }) {
  const selected = sections.find((s) => s.id === value);
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `Section: ${selected.name}` : 'Select a section'}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.dropdownTrigger}>
        <Text style={[styles.dropdownValue, !selected && styles.dropdownPlaceholder]}>{selected?.name ?? 'Select a section'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSoft} />
      </Pressable>
      {open ? (
        <ScrollView style={styles.dropdownList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {sections.map((s) => {
            const active = s.id === value;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
                style={[styles.dropdownOption, active && styles.dropdownOptionActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownName}>{s.name}</Text>
                  {s.program ? <Text style={styles.dropdownDetail}>{s.program}</Text> : null}
                </View>
                {active ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
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


const styles = themed(() => StyleSheet.create({
  year: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.muted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: '700', color: colors.text },
  dropdownLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  dropdownValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dropdownPlaceholder: { color: colors.muted, fontWeight: '500' },
  dropdownDisabled: { opacity: 0.6 },
  dropdownList: { maxHeight: 240, marginTop: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  dropdownOptionActive: { backgroundColor: colors.primarySoft },
  dropdownName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  dropdownDetail: { marginTop: 2, color: colors.textSoft, fontSize: 12 },
}));
