import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { redirect } from '@tanstack/react-router'

const isAdmin = true

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    if (isAdmin) {
      console.log('redirecting to /dashboard')
      return redirect({
        to: '/dashboard',
      })
    }
  },
})
