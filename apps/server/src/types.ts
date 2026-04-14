import { z } from 'zod';

export const lucidAgentRoleSchema = z.enum(['publisher', 'consumer']);

export const createAgentInputSchema = z.object({
  role: lucidAgentRoleSchema.default('consumer'),
  task: z.string().trim().min(1, 'task is required'),
});

export const agentIdInputSchema = z.object({
  agentId: z.string().trim().min(1),
});

export const lucidAgentRecordSchema = z.object({
  id: z.string(),
  role: lucidAgentRoleSchema,
  task: z.string(),
  heartbeatTaskId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const agentSummarySchema = z.object({
  agent_id: z.string(),
  role: lucidAgentRoleSchema,
  task: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  heartbeat: z.object({
    task_id: z.string(),
    enabled: z.boolean(),
    status: z.string(),
    next_run_at: z.string().optional(),
    last_run_at: z.string().optional(),
    last_run_id: z.string().optional(),
    progress: z.string().optional(),
    summary: z.string().optional(),
    resumable: z.boolean(),
    error: z.string().optional(),
  }),
});

export const agentListResponseSchema = z.object({
  agents: z.array(agentSummarySchema),
});

export const agentMessagesResponseSchema = z.object({
  agent_id: z.string(),
  messages: z.array(z.object({
    event: z.string(),
    data: z.record(z.unknown()),
  })),
});

export type LucidAgentRole = z.infer<typeof lucidAgentRoleSchema>;
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;
export type LucidAgentRecord = z.infer<typeof lucidAgentRecordSchema>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;
export type AgentMessagesResponse = z.infer<typeof agentMessagesResponseSchema>;
