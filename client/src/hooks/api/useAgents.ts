import { useMutation } from "@tanstack/react-query";
import { postRequest } from "../common";
import { definitions } from "@/types/apiTypes";

export type CreateAgentProps = {
  role: string
  task: string
}

export const useCreateAgent = () => useMutation({
  mutationFn: (arg: CreateAgentProps) => postRequest<definitions['controllers.StartAgentResponse']>('agents/create', arg),
})
