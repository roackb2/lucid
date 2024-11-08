import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { redirect } from '@tanstack/react-router'

const isAdmin = true

export const Route = createFileRoute('/')({
  loader: () => {
    if (isAdmin) {
      redirect({
        to: '/dashboard',
        throw: true,
      })
    }
  },
})
