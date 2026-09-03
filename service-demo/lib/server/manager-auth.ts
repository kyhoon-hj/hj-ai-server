export const LOCAL_MANAGER_COOKIE = 'service_demo_manager';

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === name) return rawValue.join('=') || null;
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isAuthorizedKnowledgeManager(request: Request): boolean {
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const allowedEmails = (process.env.SERVICE_DEMO_MANAGER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (email && allowedEmails.includes(email)) return true;

  const expectedLocalToken = process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN?.trim();
  const receivedLocalToken = cookieValue(request, LOCAL_MANAGER_COOKIE);
  return Boolean(expectedLocalToken && receivedLocalToken && constantTimeEqual(expectedLocalToken, receivedLocalToken));
}
