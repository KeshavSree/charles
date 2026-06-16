// Strategy registry: widget type → the strategy that fills it.

import type { FillStrategy, WidgetType } from '../types'
import { textStrategy, nativeSelectStrategy } from './text'
import { radioGroupStrategy } from './radioGroup'
import { checkboxStrategy } from './checkbox'
import { fileUploadStrategy } from './fileUpload'
import { checkboxGroupStrategy } from './workday/checkboxGroup'
import { comboboxStrategy } from './workday/combobox'
import { comboboxQuestionStrategy } from './workday/comboboxQuestion'
import { multiselectStrategy } from './workday/multiselect'
import { sectionStrategy } from './workday/section'
import { dateStrategy } from './workday/date'

const ALL: FillStrategy[] = [
  textStrategy,
  nativeSelectStrategy,
  dateStrategy,
  radioGroupStrategy,
  checkboxStrategy,
  checkboxGroupStrategy,
  comboboxStrategy,
  comboboxQuestionStrategy,
  sectionStrategy,
  multiselectStrategy,
  fileUploadStrategy,
]

export const STRATEGIES = new Map<WidgetType, FillStrategy>(ALL.map((s) => [s.widget, s]))
