import { useMutation } from "@tanstack/react-query";
import { apiUrl, postRequest, serverUrl } from "./common";

export type CreateAgentProps = {
  role: string
  task: string
}

export const useCreateAgent = () => useMutation({
  mutationFn: (arg: CreateAgentProps) => postRequest('agents/create', arg),
})
