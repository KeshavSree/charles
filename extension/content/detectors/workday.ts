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
    first_name: wd('legalNameSection_firstName')
              ?? wd('firstName'),
    last_name:  wd('legalNameSection_lastName')
              ?? wd('lastName'),
    email:      wd('email'),
    phone:      wd('phone-number')
              ?? wd('phoneNumber'),
    linkedin:   wd('linkedInURL')
              ?? wd('linkedin'),
    location:   wd('addressSection_city')
              ?? wd('city'),
    work_auth:  wdSelect('countryDropdown')
              ?? wdSelect('workAuthorization'),
  }
}
