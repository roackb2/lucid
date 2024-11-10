import { atom } from "jotai";
import { definitions } from "@/types/apiTypes";
import { ReadyState } from "react-use-websocket";
import { AgentNotificationTypes } from "@/types/layout";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";

const agentEvents = ['agent_progress', 'agent_response', 'agent_status']

export const readyStateAtom = atom<ReadyState>(ReadyState.UNINSTANTIATED)
export const readyStateTextAtom = atom<string>((get) => {
  return {
    [ReadyState.CONNECTING]: 'Connecting',
    [ReadyState.OPEN]: 'Open',
    [ReadyState.CLOSING]: 'Closing',
    [ReadyState.CLOSED]: 'Closed',
    [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
  }[get(readyStateAtom)]
})
export const sendJsonMessageAtom = atom<SendJsonMessage | null>(null)
export const messageHistoryAtom = atom<definitions['ws.WsMessage'][]>([])

export const agentIdsAtom = atom<string[]>([])
export const agentMessageDataAtom = atom<AgentNotificationTypes[]>((get) => {
  return get(messageHistoryAtom)
    .filter((message) => agentEvents.includes(message.event ?? ''))
    .map((message) => {
      switch (message.event) {
        case 'agent_progress':
          return message.data?.progress
        case 'agent_response':
          return message.data?.response
        case 'agent_status':
          return message.data?.status
      }
    }) as AgentNotificationTypes[]
})
export const agentMessagesByAgentIdAtom = atom<Record<string, AgentNotificationTypes[]>>((get) => {
  return get(agentMessageDataAtom).reduce((acc, message) => {
    acc[message.agent_id ?? ''] = [...(acc[message.agent_id ?? ''] ?? []), message]
    return acc
  }, {} as Record<string, AgentNotificationTypes[]>)
})
