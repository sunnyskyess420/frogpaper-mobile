// In-app help modal for BYOK (Bring Your Own Key).
//
// Renders step-by-step instructions for getting free API keys from
// Google Gemini, Hugging Face, and (optionally) Replicate. Opens from
// the Settings -> Your API keys section. Plain English, no jargon.
//
// The app does NOT bundle a README, so this modal is the only place
// users learn how to get keys. Keep it self-contained and copy-friendly.

import React from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../theme';

// Each external link is a tappable Text that opens the device browser.
function Link({ url, children }) {
  return (
    <Text
      style={styles.link}
      onPress={() => {
        Linking.openURL(url).catch(() => {
          // Silently ignore - the device may not have a browser configured.
          // The URL text is still visible so the user can type it manually.
        });
      }}
    >
      {children}
    </Text>
  );
}

export default function ByokHelpModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      transparent={false}
      animationType="slide"
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title}>How to get your API keys</Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={true}
        >
          {/* Why do I need keys? */}
          <Text style={styles.sectionTitle}>Why do I need keys?</Text>
          <Text style={styles.body}>
            FrogPaper paints wallpapers using AI engines (Google Gemini, Hugging
            Face, Replicate, and the free Pollinations). Three of those engines
            require an API key — a long password that proves you're allowed to
            use them. The keys live only on your phone, are sent only with each
            generate request, and never appear in any log or save file.
          </Text>
          <Text style={styles.body}>
            You do not have to add any keys. If you skip this, the app falls back
            to the free Pollinations engine — it works fine, just a little less
            sharp than the others. Adding at least the free Google Gemini key
            gives you much better wallpapers, no cost, and about 1,500 per day.
          </Text>

          {/* Gemini */}
          <Text style={styles.sectionTitle}>1. Google Gemini (free)</Text>
          <Text style={styles.body}>
            Google's image AI. Free with a generous daily limit (around 1,500
            images). The key looks like a long string that starts with{' '}
            <Text style={styles.mono}>AQ</Text> (newer keys) or{' '}
            <Text style={styles.mono}>AIza</Text> (older keys). Both work.
          </Text>
          <Text style={styles.step}>1. On your phone or computer, open a browser.</Text>
          <Text style={styles.step}>2. Go to <Link url="https://aistudio.google.com/apikey">aistudio.google.com/apikey</Link>.</Text>
          <Text style={styles.step}>3. Sign in with any Google account (your Gmail works).</Text>
          <Text style={styles.step}>4. Tap the "Create API key" button.</Text>
          <Text style={styles.step}>5. Copy the long string it shows you.</Text>
          <Text style={styles.step}>6. Come back to FrogPaper, Settings → Your API keys → Google Gemini key → paste → Save.</Text>

          {/* Hugging Face */}
          <Text style={styles.sectionTitle}>2. Hugging Face (free monthly credit)</Text>
          <Text style={styles.body}>
            An open-source AI community that hosts the FLUX.1 image model. They
            give you a small free credit every month (resets monthly). The token
            starts with <Text style={styles.mono}>hf_</Text>.
          </Text>
          <Text style={styles.step}>1. Open a browser.</Text>
          <Text style={styles.step}>2. Go to <Link url="https://huggingface.co/settings/tokens">huggingface.co/settings/tokens</Link>.</Text>
          <Text style={styles.step}>3. Sign up if you don't have an account (free, email confirmation needed).</Text>
          <Text style={styles.step}>4. Tap "New token".</Text>
          <Text style={styles.step}>5. Name: type "frogpaper" (any name works). Type: pick "Read".</Text>
          <Text style={styles.step}>6. Tap "Create" and copy the long string that appears (starts with hf_).</Text>
          <Text style={styles.step}>7. Come back to FrogPaper, Settings → Your API keys → Hugging Face token → paste → Save.</Text>

          {/* Replicate */}
          <Text style={styles.sectionTitle}>3. Replicate (paid, optional)</Text>
          <Text style={styles.body}>
            The paid FLUX.1 engine — the same one the original FrogPaper desktop
            used. About 2.5 cents per wallpaper. Only add this if you want the
            absolute best quality and you're willing to pay a few dollars a
            month. The token starts with <Text style={styles.mono}>r8_</Text>.
          </Text>
          <Text style={styles.step}>1. Open a browser.</Text>
          <Text style={styles.step}>2. Go to <Link url="https://replicate.com">replicate.com</Link>.</Text>
          <Text style={styles.step}>3. Sign up and add a credit card.</Text>
          <Text style={styles.step}>4. Go to <Link url="https://replicate.com/accounts">replicate.com/accounts</Link>.</Text>
          <Text style={styles.step}>5. Tap "Create token" and copy the string (starts with r8_).</Text>
          <Text style={styles.step}>6. Come back to FrogPaper, Settings → Your API keys → Replicate token → paste → Save.</Text>

          {/* What if I don't add keys */}
          <Text style={styles.sectionTitle}>What if I skip all of this?</Text>
          <Text style={styles.body}>
            The app still works. It will use Pollinations.ai — a free image AI
            that needs no key. Quality is a bit lower than the others (slightly
            softer detail, watermarks trimmed automatically), but every wallpaper
            still arrives within the 180-second limit. You can always add a key
            later when you want sharper results.
          </Text>

          {/* Security */}
          <Text style={styles.sectionTitle}>Is this safe?</Text>
          <Text style={styles.body}>
            Yes. Your keys are stored only on your phone in a private,
            per-app storage area that no other app can read. They are sent to
            the FrogPaper server only with each generate request, over an
            encrypted HTTPS connection. The server uses your key for that one
            request, then forgets it. It never writes your key to disk, never
            logs it, never echoes it in error messages.
          </Text>
          <Text style={styles.body}>
            Treat your keys like passwords — do not paste them anywhere except
            the FrogPaper Settings screen. If a key ever leaks (you posted it
            publicly, someone saw your screen, etc.), go back to the provider's
            website and revoke it, then create a new one.
          </Text>

          {/* Troubleshooting */}
          <Text style={styles.sectionTitle}>Troubleshooting</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>"No Gemini API key"</Text> — the key wasn't saved. Go back to Settings → Your API keys, paste again, tap Save.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>"Google rejected the API key"</Text> — the key is wrong, expired, or has extra spaces around it. Re-copy it from aistudio.google.com/apikey and try again.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>"Hugging Face rejected the token"</Text> — same as above. Re-copy from huggingface.co/settings/tokens.
          </Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>"Google's free daily limit is used up"</Text> — Gemini's free tier resets after midnight Pacific time. Try again tomorrow, or fall back to Pollinations for the rest of the day.
          </Text>

          {/* Close button at the bottom for one-handed reachability */}
          <Pressable style={styles.bottomClose} onPress={onClose}>
            <Text style={styles.bottomCloseText}>Got it — close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    flexWrap: 'wrap',
  },
  closeButton: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderColor: colors.border,
    borderWidth: 1,
  },
  closeButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  step: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xs,
    marginLeft: spacing.md,
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  mono: {
    color: colors.warn,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  bold: {
    color: colors.text,
    fontWeight: '700',
  },
  bottomClose: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  bottomCloseText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
});
