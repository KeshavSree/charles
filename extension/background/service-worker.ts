const API = 'http://localhost:8000'

interface CacheEntry {
  data: unknown
  expiry: number
}

const cache = new Map<string, CacheEntry>()

async function fetchProfile(resumeId: string): Promise<unknown> {
  const now = Date.now()
  const cached = cache.get(resumeId)
  if (cached && cached.expiry > now) return cached.data

  const res = await fetch(`${API}/api/profile/${resumeId}`)
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`)
  const data = await res.json()
  cache.set(resumeId, { data, expiry: now + 60_000 })
  return data
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getProfile') {
    fetchProfile(msg.resumeId)
      .then((data) => sendResponse({ profile: data }))
      .catch((err) => sendResponse({ error: String(err) }))
    return true // keep message channel open for async response
  }
})
