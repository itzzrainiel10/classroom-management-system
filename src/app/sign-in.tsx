import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Caption, Card, Field, Label } from '@/components/ui';
import { colors, radius, shadow, text } from '@/constants/theme';
import { SectionPicker, useSections } from '@/components/section-picker';
import { useAuth, type Role } from '@/lib/auth';

const SEAL = require('../../assets/images/splash-icon.png');

export default function SignIn() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === 'instructor' ? 'instructor' : 'student';
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');
  const [contact, setContact] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const { sections } = useSections();
  const [showPw, setShowPw] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    if (mode === 'up' && !name.trim()) return setMessage({ text: 'Enter your full name.', ok: false });
    if (!email.includes('@')) return setMessage({ text: 'Enter your email address.', ok: false });
    if (!password) return setMessage({ text: 'Enter your password.', ok: false });
    if (mode === 'up' && (password.length < 8 || !/[a-z]/i.test(password) || !/[0-9]/.test(password)))
      return setMessage({ text: 'Use at least 8 characters with letters and numbers.', ok: false });
    if (mode === 'up' && role === 'student' && sections?.length && !sectionId) return setMessage({ text: 'Choose your section.', ok: false });
    if (mode === 'up' && role === 'instructor') {
      if (!employeeId.trim()) return setMessage({ text: 'Enter your employee / faculty ID.', ok: false });
      if (!department.trim()) return setMessage({ text: 'Enter your department.', ok: false });
      if (!/^\+?[0-9][0-9 -]{6,18}$/.test(contact.trim())) return setMessage({ text: 'Enter a valid contact number (e.g. 0917 123 4567).', ok: false });
    }
    setBusy(true);
    setMessage(null);
    const err = mode === 'in' ? await signIn(email, password, role) : await signUp(email, password, name, role, { employee_id: employeeId, department, contact_number: contact, section_id: sectionId });
    setBusy(false);
    if (err) {
      const ok = err.startsWith('Account created') || err.startsWith('Application created');
      setMessage({ text: err, ok });
      if (ok) setMode('in');
    }
  };

  const google = async () => {
    setGoogleBusy(true);
    setMessage(null);
    const err = await signInWithGoogle(role);
    setGoogleBusy(false);
    if (err) setMessage({ text: err, ok: false });
  };

  const roleLabel = role === 'instructor' ? 'Instructor' : 'Student';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <Image source={SEAL} style={styles.seal} resizeMode="contain" accessibilityLabel="Cavite State University seal" />
            <View style={{ width: 40 }} />
          </View>

          <View style={{ gap: 10, alignItems: 'center' }}>
            <View style={styles.chip}>
              <Ionicons name={role === 'instructor' ? 'school' : 'person'} size={13} color={colors.primary} />
              <Text style={styles.chipText}>{roleLabel.toUpperCase()}</Text>
            </View>
            <Text style={[text.display, { textAlign: 'center' }]}>{mode === 'in' ? 'Welcome back' : 'Create your account'}</Text>
            <Caption style={{ textAlign: 'center', maxWidth: 300 }}>
              {mode === 'in' ? `Sign in to your ${roleLabel.toLowerCase()} account to continue.` : 'Use your CvSU email so your classes can find you.'}
            </Caption>
          </View>

          <Card style={{ gap: 16, padding: 20 }}>
            {mode === 'up' ? <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Ana Reyes" autoComplete="name" /> : null}
            {mode === 'up' && role === 'student' && sections?.length ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.fieldLabel}>Your section</Text>
                <SectionPicker sections={sections} value={sectionId} onChange={setSectionId} />
                <Text style={styles.hint}>You’ll see this section’s class schedule. Only an administrator can change it later.</Text>
              </View>
            ) : null}
            {mode === 'up' && role === 'instructor' ? (
              <>
                <View style={styles.verify}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
                  <Text style={styles.verifyText}>Instructor accounts are verified by an administrator before the instructor dashboard opens.</Text>
                </View>
                <Field label="Employee / Faculty ID" value={employeeId} onChangeText={setEmployeeId} placeholder="e.g. CvSU-2019-0142" autoCapitalize="characters" />
                <Field label="Department" value={department} onChangeText={setDepartment} placeholder="e.g. Department of Information Technology" />
                <Field label="Contact number" value={contact} onChangeText={setContact} placeholder="e.g. 0917 123 4567" keyboardType="phone-pad" autoComplete="tel" />
              </>
            ) : null}
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Enter your CvSU email"
            />
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={[styles.pwRow, pwFocused && styles.pwFocused]}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.muted}
                  autoComplete={mode === 'in' ? 'password' : 'new-password'}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  style={styles.pwInput}
                />
                <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8} accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSoft} />
                </Pressable>
              </View>
              {mode === 'in' ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-end', paddingTop: 2 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Forgot password?</Text>
                </Pressable>
              ) : null}
            </View>
            {message ? (
              <View style={[styles.notice, message.ok ? styles.noticeOk : styles.noticeErr]}>
                <Ionicons name={message.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={message.ok ? colors.primary : colors.danger} />
                <Text style={[styles.noticeText, { color: message.ok ? colors.primary : colors.danger }]}>{message.text}</Text>
              </View>
            ) : null}
            <Button title={mode === 'in' ? 'Log In' : 'Sign Up'} iconRight="arrow-forward" onPress={submit} loading={busy} disabled={googleBusy} />
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View>
            <Button
              title="Continue with Google"
              icon="logo-google"
              variant="secondary"
              onPress={google}
              loading={googleBusy}
              disabled={busy}
            />
          </Card>

          <Pressable
            onPress={() => {
              setMode(mode === 'in' ? 'up' : 'in');
              setMessage(null);
            }}
            style={{ alignSelf: 'center', padding: 8 }}>
            <Caption>
              {mode === 'in' ? 'No account yet? ' : 'Already have an account? '}
              <Text style={{ color: colors.primary, fontWeight: '800' }}>{mode === 'in' ? 'Sign Up' : 'Log In'}</Text>
            </Caption>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 22, gap: 22, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.sm,
  },
  seal: { width: 64, height: 64 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: colors.primary },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12.5, color: colors.textSoft, lineHeight: 17 },
  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  pwFocused: { borderColor: colors.primary, boxShadow: '0px 0px 0px 3px rgba(7, 91, 57, 0.12)' },
  pwInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: radius.md },
  noticeOk: { backgroundColor: colors.primarySoft },
  noticeErr: { backgroundColor: colors.dangerSoft },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  verify: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12 },
  verifyText: { flex: 1, color: colors.primary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.mint },
  orText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: colors.muted },
});
