import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// Google sign-in returns here. On web this page runs in the sign-in popup and hands the URL back
// to the app; on phones the in-app browser catches the link first, so this only shows briefly.
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  return <Redirect href="/" />;
}
