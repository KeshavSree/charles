const API = 'http://localhost:8000'
const STORAGE_KEY = 'activeResumeId'

interface ResumeSummary {
  id: string
  filename: string
}

async function loadResumes(): Promise<ResumeSummary[]> {
  const res = await fetch(`${API}/api/resumes`)
  if (!res.ok) throw new Error('Cannot reach Charles API')
  return res.json()
}

function setStatus(msg: string, type: 'ok' | 'err' | '' = '') {
  const el = document.getElementById('status')!
  el.textContent = msg
  el.className = type
}

async function init() {
  const select = document.getElementById('resume-select') as HTMLSelectElement
  const fillBtn = document.getElementById('fill-btn') as HTMLButtonElement

  try {
    const resumes = await loadResumes()
    select.innerHTML = resumes.length
      ? resumes.map((r) => `<option value="${r.id}">${r.filename}</option>`).join('')
      : '<option value="">No resumes uploaded</option>'

    const stored = await chrome.storage.local.get(STORAGE_KEY)
    if (stored[STORAGE_KEY]) select.value = stored[STORAGE_KEY]

    fillBtn.disabled = resumes.length === 0
  } catch {
    setStatus('Cannot reach Charles API (is the backend running?)', 'err')
    select.innerHTML = '<option value="">Unavailable</option>'
  }

  select.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEY]: select.value })
  })

  fillBtn.addEventListener('click', async () => {
    const resumeId = select.value
    if (!resumeId) return

    fillBtn.disabled = true
    setStatus('Filling…')

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setStatus('No active tab', 'err')
      fillBtn.disabled = false
      return
    }

    chrome.tabs.sendMessage(tab.id, { action: 'fill', resumeId }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('Page not supported or content script not loaded', 'err')
      } else if (response?.error) {
        setStatus(response.error, 'err')
      } else {
        setStatus(`Filled ${response?.filled ?? 0} field(s), skipped ${response?.skipped ?? 0}`, 'ok')
      }
      fillBtn.disabled = false
    })
  })
}

init()
