

import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormDescription, FormControl, FormItem, FormLabel, FormField, FormMessage } from "../ui/form"
import { Select, SelectValue, SelectTrigger, SelectItem, SelectContent } from "../ui/select"
import { useCreateAgent } from "@/hooks/api/useAgents"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { toast } from "sonner"
import { useEffect } from "react"

export interface CreateAgentFormProps {
  onSuccess: (agentId: string) => void
}

const schema = z.object({
  role: z.enum(['publisher', 'consumer']),
  task: z.string().min(1),
})

export default function CreateAgentForm({ onSuccess }: CreateAgentFormProps) {
  const { mutate: createAgent, isPending, isError, error, data } = useCreateAgent()

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: 'consumer',
      task: '',
    },
  })

  const {
    handleSubmit,
  } = form

  const onSubmit = (data: z.infer<typeof schema>) => {
    createAgent({
      role: data.role,
      task: data.task,
    })
  }

  useEffect(() => {
    if (isError) {
      toast.error(error.message)
    } else if (data) {
      toast.success(data.message)
      onSuccess(data.agent_id ?? '')
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
                <Select>
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
