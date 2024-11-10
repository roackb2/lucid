import { useMutation } from "@tanstack/react-query";
import { postRequest } from "../common";
import { definitions } from "@/types/apiTypes";
import { atomWithMutation } from "jotai-tanstack-query";

export type CreateAgentProps = {
  role: string
  task: string
}

const createAgentMutation = {
  mutationKey: ['createAgent'],
  mutationFn: (arg: CreateAgentProps) => postRequest<definitions['controllers.StartAgentResponse']>('agents/create', arg),
}

export const useCreateAgent = () => useMutation(createAgentMutation)

export const createAgentAtom = atomWithMutation(() => createAgentMutation)
