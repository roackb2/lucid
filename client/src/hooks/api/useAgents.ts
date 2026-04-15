import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trpc } from '@/lib/trpc'

export type CreateAgentProps = {
  role: 'publisher' | 'consumer'
  task: string
}

const agentListQueryKey = ['agents', 'list'] as const

const createAgentMutation = {
  mutationKey: ['createAgent'],
  mutationFn: (arg: CreateAgentProps) => trpc.agents.create.mutate(arg),
}

export const useCreateAgent = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...createAgentMutation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentListQueryKey })
    },
  })
}

export function useAgentList() {
  return useQuery({
    queryKey: agentListQueryKey,
    queryFn: () => trpc.agents.list.query(),
    refetchInterval: 5_000,
  })
}

export function useAgentMessages(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'messages'],
    queryFn: () => trpc.agents.messages.query({ agentId }),
    refetchInterval: 5_000,
    enabled: Boolean(agentId),
  })
}

export function useRunAgentOnce(agentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['agents', agentId, 'runOnce'],
    mutationFn: () => trpc.agents.runOnce.mutate({ agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentListQueryKey })
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'messages'] })
    },
  })
}
