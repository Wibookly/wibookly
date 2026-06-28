/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcomeSso } from './welcome-sso.tsx'
import { template as welcomeTempPassword } from './welcome-temp-password.tsx'
import { template as welcomeAccessGranted } from './welcome-access-granted.tsx'
import { template as followUpReminder } from './follow-up-reminder.tsx'
import { template as integrationAlert } from './integration-alert.tsx'
import { template as flaggedEmailReport } from './flagged-email-report.tsx'
import { template as aiActivityReport } from './ai-activity-report.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome-sso': welcomeSso,
  'welcome-temp-password': welcomeTempPassword,
  'welcome-access-granted': welcomeAccessGranted,
  'follow-up-reminder': followUpReminder,
  'integration-alert': integrationAlert,
  'flagged-email-report': flaggedEmailReport,
  'ai-activity-report': aiActivityReport,
}
