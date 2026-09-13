export const STANDARD_PORTS = Object.freeze({
  aiServer: 11000,
  validationDemo: 11001,
  serviceDemo: 11002,
  consoleWeb: 11003,
});

export function requireStandardPort(component, value) {
  const expected = STANDARD_PORTS[component];
  if (!expected)
    throw new Error(`알 수 없는 포트 구성요소입니다: ${component}`);

  const port =
    value === undefined || value === null || value === ''
      ? expected
      : Number(value);
  if (!Number.isInteger(port) || port !== expected) {
    throw new Error(
      `${component} 포트는 로컬·운영 공통 ${expected}로 고정되어야 합니다.`,
    );
  }
  return port;
}
