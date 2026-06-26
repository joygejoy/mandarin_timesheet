import type { Metadata } from 'next'
import LandingRoot from './LandingRoot'

export const metadata: Metadata = {
  title: 'Mandarin Timesheet — Restaurant payroll, simplified',
  description:
    'AI-powered timesheet scanning for restaurant managers. Photograph sign-in sheets, review AI-extracted shifts, and export biweekly pay summaries.',
}

export default function LandingPage() {
  return <LandingRoot />
}
