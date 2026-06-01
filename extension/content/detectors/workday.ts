function wd(automationId: string): HTMLElement | null {
  const container = document.querySelector(`[data-automation-id="${automationId}"]`)
  if (!container) return null
  return (
    container.querySelector<HTMLElement>('input')
    ?? container.querySelector<HTMLElement>('textarea')
    ?? container as HTMLElement
  )
}

function wdSelect(automationId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-automation-id="${automationId}"] [data-automation-id="selectWidget"]`
  ) ?? wd(automationId)
}

export function detectFieldsWorkday(): Record<string, HTMLElement | null> {
  return {
    first_name: wd('formField-legalName--firstName')
              ?? wd('legalNameSection_firstName')
              ?? wd('firstName'),
    last_name:  wd('formField-legalName--lastName')
              ?? wd('legalNameSection_lastName')
              ?? wd('lastName'),
    email:      wd('formField-email')
              ?? wd('email'),
    phone:      wd('formField-phoneNumber')
              ?? wd('phone-number')
              ?? wd('phoneNumber'),
    location:   wd('formField-city')
              ?? wd('addressSection_city')
              ?? wd('city'),
  }
}
