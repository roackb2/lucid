import AgentStatusCard, { type AgentStatusMessage } from '@/components/features/agent-status-card'
import CreateAgentForm from '@/components/features/create-agent-form'
import { useAgentList, useAgentMessages, useRunAgentOnce } from '@/hooks/api/useAgents'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/experiments/single-agent/')({
  component: SingleAgent,
})


function SingleAgent() {
  const agentsQuery = useAgentList()

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-row items-center gap-2 bg-gray-100 p-2 rounded-md">
        <span className="text-sm text-gray-500">
          Lucid TS backend: {agentsQuery.isError ? 'Error' : agentsQuery.isFetching ? 'Syncing' : 'Connected'}
        </span>
      </div>
      <CreateAgentForm />
      <div className="flex flex-row flex-wrap gap-4">
        {agentsQuery.data?.agents.map((agent) => (
          <AgentCardFromApi key={agent.agent_id} agentId={agent.agent_id} />
        ))}
        {!agentsQuery.data?.agents.length && (
          <p className="text-sm text-gray-500">No agents yet.</p>
        )}
      </div>
    </div>
  )
}

function AgentCardFromApi({ agentId }: { agentId: string }) {
  const messagesQuery = useAgentMessages(agentId)
  const runOnce = useRunAgentOnce(agentId)
  const messages = messagesQuery.data?.messages.flatMap(flattenLucidMessage) ?? []

  return (
    <AgentStatusCard
      agentId={agentId}
      messages={messages}
      onRunOnce={() => runOnce.mutate()}
      isRunning={runOnce.isPending}
    />
  )
}

function flattenLucidMessage(message: { event: string; data: Record<string, unknown> }): AgentStatusMessage[] {
  if (message.event === 'agent_status' && isRecord(message.data.status)) {
    return [message.data.status as AgentStatusMessage]
  }

  if (message.event === 'agent_progress' && isRecord(message.data.progress)) {
    return [message.data.progress as AgentStatusMessage]
  }

  if (message.event === 'agent_response' && isRecord(message.data.response)) {
    return [message.data.response as AgentStatusMessage]
  }

  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
