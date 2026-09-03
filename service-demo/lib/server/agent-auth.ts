import { timingSafeEqual } from 'node:crypto';

export const LOCAL_AGENT_COOKIE = 'service_demo_agent';

function cookieValue(request: Request, name: string): string | null {
  for (const cookie of request.headers.get('cookie')?.split(';') ?? []) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function sameSecret(left: string | null, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedServiceAgent(request: Request): boolean {
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const allowedEmails = (process.env.SERVICE_DEMO_AGENT_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (email && allowedEmails.includes(email)) return true;
  return sameSecret(cookieValue(request, LOCAL_AGENT_COOKIE), process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN?.trim());
}
