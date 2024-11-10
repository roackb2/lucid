import { definitions } from "./apiTypes"

export type AgentNotificationTypes =
  | definitions['worker.WorkerProgressNotification']
  | definitions['worker.WorkerResponseNotification']
  | definitions['worker.WorkerStatusNotification']
