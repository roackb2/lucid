import type { AgentCoreHttpConfig } from '../agentcore/types.js';
import type { HeddleExecutionConfig } from '../heddle/types.js';
import type { RuntimeSessionConfig } from '../runtime-session/types.js';

export type RuntimeConfig = AgentCoreHttpConfig
  & HeddleExecutionConfig
  & RuntimeSessionConfig
  & {
    host: '0.0.0.0';
    port: 8080;
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  };
