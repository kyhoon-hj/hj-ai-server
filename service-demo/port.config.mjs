export const SERVICE_DEMO_STANDARD_PORT = 11002;
export const AI_SERVER_PORT = 11000;

export function requireServiceDemoPort(value) {
  const port = value === undefined || value === null || value === ''
    ? SERVICE_DEMO_STANDARD_PORT
    : Number(value);
  if (!Number.isInteger(port) || port !== SERVICE_DEMO_STANDARD_PORT) {
    throw new Error(`serviceDemo 포트는 로컬·운영 공통 ${SERVICE_DEMO_STANDARD_PORT}로 고정되어야 합니다.`);
  }
  return port;
}

export const SERVICE_DEMO_PORT = requireServiceDemoPort(process.env.SERVICE_DEMO_PORT);
