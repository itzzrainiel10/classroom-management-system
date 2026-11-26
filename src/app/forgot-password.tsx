import Ionicons from '@expo/vector-icons/Ionicons';
import { createClient } from '@supabase/supabase-js';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Caption, Card, Field } from '@/components/ui';
import { colors, radius, shadow, text } from '@/constants/theme';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Separate, memory-only client for the reset: verifying the code signs this client in, and we don't
 * want the app itself to treat the user as logged in halfway through. It signs out when done.
 */
const resetClient = () =>
  url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;

const CODE_LEN = 6;

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const client = useRef(resetClient()).current;
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const cleanEmail = email.trim().toLowerCase();

  const sendCode = async () => {
    if (!client) return setMessage({ text: 'The app is not connected to the server.', ok: false });
    if (!cleanEmail.includes('@')) return setMessage({ text: 'Enter your email address.', ok: false });
    setBusy(true);
    setMessage(null);
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail);
    setBusy(false);
    if (error) return setMessage({ text: error.message, ok: false });
    setStep('code');
    setMessage({ text: `If an account uses ${cleanEmail}, we sent it a ${CODE_LEN}-digit code. Check your inbox and spam folder.`, ok: true });
  };

  const reset = async () => {
    if (!client) return;
    if (code.trim().length !== CODE_LEN) return setMessage({ text: `Enter the ${CODE_LEN}-digit code from the email.`, ok: false });
    if (password.length < 8 || !/[a-z]/i.test(password) || !/[0-9]/.test(password)) return setMessage({ text: 'Use at least 8 characters with letters and numbers.', ok: false });
    if (password !== confirm) return setMessage({ text: 'The two passwords do not match.', ok: false });
    setBusy(true);
    setMessage(null);
    const verified = await client.auth.verifyOtp({ email: cleanEmail, token: code.trim(), type: 'recovery' });
    if (verified.error) {
      setBusy(false);
      return setMessage({ text: 'That code is wrong or has expired. Check the email or send a new code.', ok: false });
    }
    const updated = await client.auth.updateUser({ password });
    await client.auth.signOut({ scope: 'local' });
    setBusy(false);
    if (updated.error) return setMessage({ text: updated.error.message, ok: false });
    setMessage(null);
    setStep('done');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>

          <View style={{ gap: 10, alignItems: 'center' }}>
            <View style={styles.iconCircle}>
              <Ionicons name={step === 'done' ? 'checkmark' : 'key-outline'} size={30} color={colors.primary} />
            </View>
            <Text style={[text.display, { textAlign: 'center' }]}>
              {step === 'email' ? 'Forgot password?' : step === 'code' ? 'Reset your password' : 'Password changed'}
            </Text>
            <Caption style={{ textAlign: 'center', maxWidth: 300 }}>
              {step === 'email'
                ? 'Enter your account email and we’ll send you a code to reset your password.'
                : step === 'code'
                  ? 'Enter the code from the email, then choose a new password.'
                  : 'You can now log in with your new password.'}
            </Caption>
          </View>

          <Card style={{ gap: 16, padding: 20 }}>
            {step === 'email' ? (
              <Field
                label="Email address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="Enter your CvSU email"
              />
            ) : null}

            {step === 'code' ? (
              <>
                <Field
                  label={`${CODE_LEN}-digit code`}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LEN))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  placeholder="123456"
                  maxLength={CODE_LEN}
                />
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>New password</Text>
                  <View style={styles.pwRow}>
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPw}
                      placeholder="At least 6 characters"
                      placeholderTextColor={colors.muted}
                      autoComplete="new-password"
                      style={styles.pwInput}
                    />
                    <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8} accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSoft} />
                    </Pressable>
                  </View>
                </View>
                <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry={!showPw} placeholder="Type it again" autoComplete="new-password" />
              </>
            ) : null}

            {message ? (
              <View style={[styles.notice, message.ok ? styles.noticeOk : styles.noticeErr]}>
                <Ionicons name={message.ok ? 'mail-outline' : 'alert-circle'} size={18} color={message.ok ? colors.primary : colors.danger} />
                <Text style={[styles.noticeText, { color: message.ok ? colors.primary : colors.danger }]}>{message.text}</Text>
              </View>
            ) : null}

            {step === 'email' ? <Button title="Send code" iconRight="arrow-forward" onPress={sendCode} loading={busy} /> : null}
            {step === 'code' ? (
              <>
                <Button title="Change password" iconRight="arrow-forward" onPress={reset} loading={busy} />
                <Pressable onPress={sendCode} disabled={busy} style={{ alignSelf: 'center', padding: 4 }}>
                  <Caption>
                    Didn’t get it? <Text style={{ color: colors.primary, fontWeight: '800' }}>Send a new code</Text>
                  </Caption>
                </Pressable>
              </>
            ) : null}
            {step === 'done' ? <Button title="Back to Log In" icon="log-in-outline" onPress={() => router.back()} /> : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 22, gap: 22, flexGrow: 1 },
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
  iconCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  pwInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: radius.md },
  noticeOk: { backgroundColor: colors.primarySoft },
  noticeErr: { backgroundColor: colors.dangerSoft },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
});
