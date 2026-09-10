/** Dedicated Frame apps never retain conversation content in operational query logs. */
export function omitConversationContent(appcode: string): boolean {
  return (
    /^zinframe(?:[-_]|$)/i.test(appcode) ||
    (process.env.CONTENT_LOG_DISABLED_APPCODES ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .includes(appcode)
  );
}
