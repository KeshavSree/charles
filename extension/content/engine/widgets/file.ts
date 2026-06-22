// Resume PDF upload — shared across ATSes. A real <input type=file> is hidden behind a
// dropzone; we can't drive the OS picker, but we can assign files via DataTransfer + change
// (and fire a drop for dropzone widgets). The leaf rule is a catch-all (the file input
// carries no field text), and fill reads the PDF from the request, not from input.value.
// Ported from the old file-upload strategy + the detectors' file pass.

import { base64ToFile, wait, log } from '../dom'
import type { Widget } from '../types'

export const fileWidget: Widget = {
  name: 'file',
  priority: 70,
  detect(doc) {
    const input =
      doc.querySelector<HTMLElement>('input[type="file"][data-automation-id="file-upload-input-ref"]') ??
      doc.querySelector<HTMLElement>('input[type="file"]')
    return input ? [{ handle: input }] : []
  },
  label() {
    return 'resume'
  },
  async fill(c, _input, ctx) {
    const resume = ctx.req.resume
    if (!resume) return []
    const el = c.handle as HTMLInputElement
    try {
      const file = base64ToFile(resume.base64, resume.filename)
      const dt = new DataTransfer()
      dt.items.add(file)
      el.files = dt.files
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))

      const dropZone = el
        .closest('[data-automation-id="attachments-FileUpload"]')
        ?.querySelector('[data-automation-id="file-upload-drop-zone"]')
      if (dropZone) {
        const dropDt = new DataTransfer()
        dropDt.items.add(file)
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropDt }))
      }

      log(`resume filled ✓ = "${resume.filename}"`)
      await wait(500)
      return [{ role: 'resume', status: 'filled' }]
    } catch (e) {
      log(`resume skipped — ${e instanceof Error ? e.message : 'upload error'}`)
      return [{ role: 'resume', status: 'failed' }]
    }
  },
  isEmpty() {
    return false
  },
}
