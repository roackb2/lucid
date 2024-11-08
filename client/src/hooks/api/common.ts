
const isDev = true
export const serverUrl = isDev ? 'http://localhost:8081' : 'https://api.lucid.ai'
export const apiUrl = (path: string) => `${serverUrl}/api/v1/${path}`
export const wsUrl = isDev ? 'ws://localhost:8082/' : 'wss://api.lucid.ai/'

export const getRequest = (path: string) => fetch(apiUrl(path), {
  mode: 'cors',
}).then((res) => res.json())
export const postRequest = (path: string, body: any) => fetch(apiUrl(path), {
  method: 'POST',
  body: JSON.stringify(body),
  mode: 'cors',
}).then((res) => res.json())
