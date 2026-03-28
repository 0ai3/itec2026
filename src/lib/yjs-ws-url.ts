export const DEFAULT_YJS_PORT = 1234

const normalizeWsUrl = (candidate: string): string | null => {
  const trimmed = candidate.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || !parsed.hostname) {
      return null
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export const resolveYjsWsUrl = (configuredValue?: string) => {
  const configured = normalizeWsUrl(configuredValue ?? '')
  if (configured) {
    return configured
  }

  if (typeof window !== 'undefined' && window.location.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.hostname}:${DEFAULT_YJS_PORT}`
  }

  return `ws://localhost:${DEFAULT_YJS_PORT}`
}
