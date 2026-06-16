// Resume PDF upload. Workday hides a real <input type=file> behind a dropzone; we
// can't drive the OS picker, but we can assign files via DataTransfer + change.

import { base64ToFile, wait, log } from '../dom'
import type { FillStrategy } from '../types'

export const fileUploadStrategy: FillStrategy = {
  widget: 'file-upload',
  priority: 70,
  async fill(field, ctx) {
    const resume = ctx.req.resume
    if (!resume) return []
    const input = field.handle as HTMLInputElement
    try {
      const file = base64ToFile(resume.base64, resume.filename)
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))

      // Fallback for dropzone-based widgets: fire a drop carrying the same file.
      const dropZone = input
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
}
