import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/home/')({
  component: Home,
})


function Home() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1>Hello /dashboard/home/!</h1>
    </div>
  )
}
