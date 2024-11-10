

import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormDescription, FormControl, FormItem, FormLabel, FormField, FormMessage } from "../ui/form"
import { Select, SelectValue, SelectTrigger, SelectItem, SelectContent } from "../ui/select"
import { createAgentAtom, useCreateAgent } from "@/hooks/api/useAgents"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { toast } from "sonner"
import { useEffect } from "react"
import { atom, useAtom, useAtomValue } from "jotai"
import { agentIdsAtom } from "@/atoms/websocketAtoms"

const schema = z.object({
  role: z.enum(['publisher', 'consumer']).default('consumer').optional(),
  task: z.string().min(1).optional(),
})

const formAtom = atom<z.infer<typeof schema>>({
  role: 'consumer',
  task: '',
})

export default function CreateAgentForm() {
  const [formValues, setFormValues] = useAtom(formAtom)
  const [createAgentMutation] = useAtom(createAgentAtom)
  const { mutate: createAgent, isPending, isError, error, data } = createAgentMutation
  const [agentIds, setAgentIds] = useAtom(agentIdsAtom)

  const onAgentCreated = (agentId: string) => {
    if (!agentIds.includes(agentId)) {
      setAgentIds([...agentIds, agentId])
    }
  }

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: formValues,
  })

  const {
    handleSubmit,
  } = form

  useEffect(() => {
    const { unsubscribe } = form.watch((values) => {
      setFormValues(values)
    })
    return () => unsubscribe()
  }, [form.watch])

  const onSubmit = (data: z.infer<typeof schema>) => {
    createAgent({
      role: data.role ?? 'consumer',
      task: data.task ?? '',
    })
  }

  useEffect(() => {
    if (isError) {
      toast.error(error as string)
    } else if (data) {
      toast.success(data.message)
      onAgentCreated(data.agent_id ?? '')
    }
  }, [isError, error, data])

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 min-w-[300px]">
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="publisher">Publisher</SelectItem>
                    <SelectItem value="consumer">Consumer</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription></FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="task"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Task</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormDescription></FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button variant="outline" type="submit" disabled={isPending}>Create Agent</Button>
      </form>
    </Form>
  )
}
