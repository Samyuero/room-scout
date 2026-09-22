type LogValue = string | number | boolean | null | undefined;

/** Never pass private document, payment, email, or phone values in context. */
export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  context: Record<string, LogValue> = {},
) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (__DEV__) console.info(line);
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong') {
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (/unknownhostexception|unable to resolve host|network request failed|fetch failed/i.test(message)) {
    return 'Cannot reach Room Scout online. Check this device’s internet connection or DNS settings, then try again.';
  }
  return message;
}
