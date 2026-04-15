import dayjs from 'dayjs'

export type AgentStatusMessage =
  {
    agent_id?: string
    status?: string
    progress?: string
    response?: string
    timestamp?: string
  }

interface AgentStatusCardProps {
  agentId: string
  messages: AgentStatusMessage[]
  onRunOnce?: () => void
  isRunning?: boolean
}


export default function AgentStatusCard({ agentId, messages, onRunOnce, isRunning }: AgentStatusCardProps) {
  const lastMessage = messages[messages.length - 1]
  const lastTimestamp = lastMessage?.timestamp ? dayjs(lastMessage.timestamp).format('YYYY-MM-DD HH:mm:ss') : 'No activity yet'
  const lastStatusMessage = messages.findLast(
    (message) => 'status' in message,
  )
  const lastProgressMessage = messages.findLast(
    (message) => 'progress' in message,
  )
  const lastResponseMessage = messages.findLast(
    (message) => 'response' in message,
  )

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 max-w-[500px]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">
          {agentId} ({lastStatusMessage?.status ?? 'unknown'})
        </p>
        {onRunOnce && (
          <button
            className="rounded border px-2 py-1 text-xs text-gray-600 disabled:opacity-50"
            disabled={isRunning}
            onClick={onRunOnce}
            type="button"
          >
            {isRunning ? 'Running...' : 'Run once'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">{lastTimestamp}</p>
      {lastProgressMessage?.progress && (
        <p className="text-sm">{lastProgressMessage.progress}</p>
      )}
      {lastResponseMessage?.response && (
        <p className="text-sm">{lastResponseMessage.response}</p>
      )}
    </div>
  )
}
