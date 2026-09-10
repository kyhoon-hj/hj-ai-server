const accessLevels = new Set(['PUBLIC', 'INTERNAL', 'RESTRICTED']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badRequest(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) badRequest(`${label}을(를) 입력해 주세요.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) badRequest(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  return normalized;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    badRequest(`${label}은(는) ${minimum}~${maximum} 사이의 정수여야 합니다.`);
  }
  return normalized;
}

export function assertAppId(value) {
  if (!uuidPattern.test(value ?? '')) badRequest('유효한 앱 ID가 필요합니다.');
  return value;
}

export function normalizeCreateAppInput(input = {}) {
  if (input.confirmIssue !== true) badRequest('AppKey 발급 확인이 필요합니다.');
  const appname = requiredText(input.appname, '앱 이름', 120);
  const appcode = requiredText(input.appcode, '앱 코드', 63).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(appcode)) {
    badRequest('앱 코드는 영문 소문자와 숫자로 시작하고 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.');
  }
  const requestedLevels = Array.isArray(input.allowedAccessLevels) ? input.allowedAccessLevels : ['PUBLIC'];
  const allowedAccessLevels = [...new Set(requestedLevels)];
  if (allowedAccessLevels.length === 0 || allowedAccessLevels.some((level) => !accessLevels.has(level))) {
    badRequest('유효한 지식 접근 등급을 한 개 이상 선택해 주세요.');
  }

  const body = {
    appname,
    appcode,
    allowedAccessLevels,
    status: 'active',
    remark: typeof input.remark === 'string' && input.remark.trim() ? input.remark.trim().slice(0, 500) : undefined,
    appkeyTtlDays: optionalInteger(input.appkeyTtlDays, '유효기간', 1, 3650),
    maxStorageMb: optionalInteger(input.maxStorageMb, '저장공간', 1, 1048576),
    monthlyTokenLimit: optionalInteger(input.monthlyTokenLimit, '월 토큰 한도', 1, Number.MAX_SAFE_INTEGER),
    metadata: { purpose: 'appkey-admin-console' },
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function normalizeRotateAppInput(input = {}) {
  if (input.confirmRotate !== true) badRequest('AppKey 회전 확인이 필요합니다.');
  return {
    gracePeriodSeconds: optionalInteger(input.gracePeriodSeconds ?? 300, '이전 키 유예시간', 0, 86400),
    ttlDays: optionalInteger(input.ttlDays ?? 90, '새 키 유효기간', 1, 3650),
  };
}

export function normalizeStatusInput(input = {}) {
  if (input.confirmStatusChange !== true) badRequest('앱 상태 변경 확인이 필요합니다.');
  if (!['active', 'inactive'].includes(input.status)) badRequest('앱 상태는 active 또는 inactive여야 합니다.');
  return { status: input.status };
}

export function publicApp(app = {}) {
  const { appkey: _appkey, appkeyHash: _appkeyHash, previousAppkeyHash: _previousAppkeyHash, ...safe } = app;
  return safe;
}

export function issuedApp(app = {}) {
  if (typeof app.appkey !== 'string' || !app.appkey) throw Object.assign(new Error('AI Server가 AppKey 원문을 반환하지 않았습니다.'), { statusCode: 502 });
  return {
    app: publicApp(app),
    issued: {
      appkey: app.appkey,
      expiresAt: app.appkeyExpiresAt ?? null,
      rotatedAt: app.appkeyRotatedAt ?? null,
      previousAppkeyValidUntil: app.previousAppkeyValidUntil ?? null,
    },
  };
}
