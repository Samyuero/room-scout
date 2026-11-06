import { createContext, createRef, use, useEffect, useImperativeHandle, useState, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorNotice } from '@/components/error-notice';

type NoticeTone = 'error' | 'warning';
const display = createRef<{ show: (message: string, tone: NoticeTone) => void }>();
const ErrorContext = createContext<{ id: number; message: string; tone: NoticeTone } | null>(null);

/** Direct UI call shared by form and upload failures. Confirmation dialogs stay interactive. */
export function showError(title: string, message?: string) {
  display.current?.show(message ? title + ': ' + message : title, 'error');
}

/** Non-blocking warning in the same safe-area-aware top notice as form feedback. */
export function showWarning(title: string, message?: string) {
  display.current?.show(message ? title + ': ' + message : title, 'warning');
}

export function ErrorToastProvider({ children }: PropsWithChildren) {
  const [notice, setNotice] = useState<{ id: number; message: string; tone: NoticeTone } | null>(null);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 3250); return () => clearTimeout(timer); }, [notice]);
  useImperativeHandle(display, () => ({ show: (message, tone) => setNotice((current) => ({ id: (current?.id || 0) + 1, message, tone })) }), []);
  return <ErrorContext.Provider value={notice}>{children}</ErrorContext.Provider>;
}

export function ErrorToast() {
  const insets = useSafeAreaInsets();
  const notice = use(ErrorContext);
  return <View pointerEvents="none" style={[styles.position, { top: insets.top + 8 }]}>{notice && <ErrorNotice key={notice.id} message={notice.message} tone={notice.tone} />}</View>;
}
const styles = StyleSheet.create({ position: { position: 'absolute', left: 0, right: 0, zIndex: 10000, elevation: 100 } });
