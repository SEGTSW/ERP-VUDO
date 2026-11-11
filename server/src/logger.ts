import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  redact: { paths: ['req.headers.cookie', 'password', '*.password', 'current', 'next'], remove: true },
});
