import { requireStandardPort, STANDARD_PORTS } from '../config/standard-ports.mjs';

export const SERVICE_DEMO_PORT = requireStandardPort(
  'serviceDemo',
  process.env.SERVICE_DEMO_PORT,
);
export const AI_SERVER_PORT = STANDARD_PORTS.aiServer;
