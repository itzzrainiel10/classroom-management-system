import Ionicons from '@expo/vector-icons/Ionicons';
import { createClient } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Caption, Card, Field, H2, Screen } from '@/components/ui';
import { colors, radius, themed } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const CODE_LEN = 6;

/**
 * Memory-only client for the reset: verifying the code signs this client in, not the app's own
 * session, so you stay logged in the whole time. It signs out when done.
 */
const resetClient = () =>
  url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;

/** Settings → Reset password: a code is emailed to the account, then a new password is set. */
export default function ChangePassword() {
  const { email } = useAuth();
  const client = useRef(resetClient()).current;
  const [step, setStep] = useState<'send' | 'code' | 'done'>('send');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const address = (email ?? '').trim().toLowerCase();

  const sendCode = async () => {
    if (!client) return setMessage({ text: 'The app is not connected to the server.', ok: false });
    if (!address) return setMessage({ text: 'This account has no email address.', ok: false });
    setBusy(true);
    setMessage(null);
    const { error } = await client.auth.resetPasswordForEmail(address);
    setBusy(false);
    if (error) return setMessage({ text: error.message, ok: false });
    setStep('code');
    setMessage({ text: `We sent a ${CODE_LEN}-digit code to ${address}. Check your inbox and spam folder.`, ok: true });
  };

  const save = async () => {
    if (!client) return;
    if (code.trim().length !== CODE_LEN) return setMessage({ text: `Enter the ${CODE_LEN}-digit code from the email.`, ok: false });
    if (password.length < 8 || !/[a-z]/i.test(password) || !/[0-9]/.test(password)) return setMessage({ text: 'Use at least 8 characters with letters and numbers.', ok: false });
    if (password !== confirm) return setMessage({ text: 'The two passwords do not match.', ok: false });
    setBusy(true);
    setMessage(null);
    const verified = await client.auth.verifyOtp({ email: address, token: code.trim(), type: 'recovery' });
    if (verified.error) {
      setBusy(false);
      return setMessage({ text: 'That code is wrong or has expired. Check the newest email or send a new code.', ok: false });
    }
    const updated = await client.auth.updateUser({ password });
    await client.auth.signOut({ scope: 'local' });
    setBusy(false);
    if (updated.error) {
      return setMessage({ text: /different from the old/i.test(updated.error.message) ? 'Choose a password different from your old one.' : updated.error.message, ok: false });
    }
    setStep('done');
  };

  return (
    <>
      <Screen>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={styles.iconCircle}>
            <Ionicons name={step === 'done' ? 'checkmark' : 'key-outline'} size={28} color={colors.primary} />
          </View>
          <H2 style={{ textAlign: 'center' }}>{step === 'done' ? 'Password changed' : 'Reset your password'}</H2>
          <Caption style={{ textAlign: 'center', maxWidth: 300 }}>
            {step === 'send'
              ? 'We’ll email a 6-digit code to your account. You stay logged in while you change it.'
              : step === 'code'
                ? 'Enter the code from the email, then choose a new password.'
                : 'Use your new password the next time you log in, here or on the website.'}
          </Caption>
        </View>

        <Card style={{ gap: 16 }}>
          {step === 'send' ? (
            <View style={styles.emailRow}>
              <Ionicons name="mail-outline" size={18} color={colors.primary} />
              <Text style={styles.email} numberOfLines={1}>
                {address || 'No email on this account'}
              </Text>
            </View>
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
                    placeholder="At least 8 characters"
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
              <Ionicons name={message.ok ? 'mail-outline' : 'alert-circle-outline'} size={18} color={message.ok ? colors.primary : colors.danger} />
              <Text style={[styles.noticeText, { color: message.ok ? colors.text : colors.danger }]}>{message.text}</Text>
            </View>
          ) : null}

          {step === 'send' ? <Button title="Send code to my email" icon="paper-plane-outline" onPress={sendCode} loading={busy} disabled={!address} /> : null}
          {step === 'code' ? (
            <>
              <Button title="Save new password" icon="checkmark" onPress={save} loading={busy} />
              <Button title="Send a new code" variant="ghost" onPress={sendCode} disabled={busy} small />
            </>
          ) : null}
          {step === 'done' ? <Button title="Back to Settings" onPress={() => router.back()} /> : null}
        </Card>
      </Screen>
    </>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    emailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
    email: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
    pwRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      paddingHorizontal: 14,
    },
    pwInput: { flex: 1, paddingVertical: 13, fontSize: 15, color: colors.text },
    notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.md },
    noticeOk: { backgroundColor: colors.primarySoft },
    noticeErr: { backgroundColor: colors.dangerSoft },
    noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  }),
);
