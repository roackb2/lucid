import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const DEFAULT_WEB_PORT = 3080
const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:8081'
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, REPOSITORY_ROOT, '')
  const port = resolvePort(environment.LUCID_WEB_PORT)
  const serverOrigin = resolveServerOrigin(environment.LUCID_SERVER_ORIGIN)
  const allowedHosts = resolveAllowedHosts(environment.LUCID_WEB_ALLOWED_HOSTS)

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      allowedHosts,
      proxy: {
        '/api/trpc': serverOrigin,
        '/hosted-execution': serverOrigin,
      },
    },
    preview: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      allowedHosts,
    },
  }
})

function resolvePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_WEB_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('LUCID_WEB_PORT must be an integer from 1 through 65535.')
  }
  return port
}

function resolveServerOrigin(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_SERVER_ORIGIN
  const url = new URL(candidate)
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.origin !== candidate
  ) {
    throw new Error(
      'LUCID_SERVER_ORIGIN must be an HTTP(S) origin without a path, query, or fragment.',
    )
  }
  return url.origin
}

export function resolveAllowedHosts(value: string | undefined): string[] {
  return (value
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) ?? [])
    .map((host) => validateExactHostname(host))
}

function validateExactHostname(host: string): string {
  let candidate: URL
  try {
    candidate = new URL(`http://${host}`)
  } catch {
    throw new Error(
      'LUCID_WEB_ALLOWED_HOSTS must contain comma-separated exact hostnames.',
    )
  }
  if (
    host === '*'
    || host.startsWith('.')
    || candidate.hostname !== host.toLowerCase()
    || candidate.port
    || candidate.username
    || candidate.password
    || candidate.pathname !== '/'
    || candidate.search
    || candidate.hash
  ) {
    throw new Error(
      'LUCID_WEB_ALLOWED_HOSTS must contain comma-separated exact hostnames.',
    )
  }
  return candidate.hostname
}
