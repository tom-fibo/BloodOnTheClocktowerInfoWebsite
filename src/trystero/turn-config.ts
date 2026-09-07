import type { TurnServerConfig } from 'trystero'

// Trystero only ever configures STUN servers by default — never TURN — so peers
// behind a symmetric NAT or a restrictive firewall (common on public/guest Wi-Fi)
// can fail to connect directly even though the same code works fine at home. This
// fetches a fresh TURN/STUN list from Metered's free-tier REST API, which is
// explicitly documented as safe to call straight from browser JS (it hands back
// short-lived per-request credentials, not a long-lived secret). Isolated to this
// one module so swapping providers later means touching only this file.
const FETCH_TIMEOUT_MS = 5000

export async function fetchTurnIceServers(): Promise<TurnServerConfig[] | undefined> {
  const appName = import.meta.env.VITE_METERED_APP_NAME
  const apiKey = import.meta.env.VITE_METERED_API_KEY
  if (!appName || !apiKey) {
    console.warn(
      '[trystero] VITE_METERED_APP_NAME/VITE_METERED_API_KEY not set — joining with STUN only. ' +
        'Connections across restrictive networks (e.g. public/guest Wi-Fi) may fail. See .env.example.',
    )
    return undefined
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { signal: controller.signal },
    )
    if (!response.ok) throw new Error(`Metered TURN credentials request failed: HTTP ${response.status}`)

    const servers = await response.json()
    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error('Metered TURN credentials response was empty or malformed')
    }
    return servers as TurnServerConfig[]
  } catch (err) {
    console.warn('[trystero] Failed to fetch TURN credentials from Metered — falling back to STUN only.', err)
    return undefined
  } finally {
    clearTimeout(timeoutId)
  }
}
