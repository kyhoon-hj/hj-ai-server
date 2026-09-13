export const CONSOLE_WEB_STANDARD_PORT = 11003;
export const AI_SERVER_STANDARD_PORT = 11000;

export function requireConsoleWebPort(value) {
  const port =
    value === undefined || value === null || value === ''
      ? CONSOLE_WEB_STANDARD_PORT
      : Number(value);
  if (!Number.isInteger(port) || port !== CONSOLE_WEB_STANDARD_PORT) {
    throw new Error(
      `consoleWeb 포트는 로컬·운영 공통 ${CONSOLE_WEB_STANDARD_PORT}로 고정되어야 합니다.`,
    );
  }
  return port;
}

export const CONSOLE_WEB_PORT = requireConsoleWebPort(
  process.env.CONSOLE_WEB_PORT,
);
