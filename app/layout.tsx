import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { TopNav } from './_components/TopNav'
import { getSession } from '@/lib/auth'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { departmentDisplayNames } from '@/lib/permissions'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Mandarin Timesheet',
  description: 'Scan, review, and roll up restaurant payroll.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ec008c' },
    { media: '(prefers-color-scheme: dark)', color: '#ec008c' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const sessionDepartment = session?.department ?? 'all'

  // Only worth the query when there's someone logged in to show a toggle for
  // — /login and /landing (where TopNav renders nothing) skip it entirely.
  const departmentLabels =
    session && isSupabaseConfigured()
      ? await departmentDisplayNames(getSupabaseAdmin())
      : { servers_bus: 'Servers & Bus', hostess_bar: 'Hostess & Bar' }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full text-[color:var(--foreground)]"
        style={{
          backgroundColor: 'var(--background)',
          backgroundImage: [
            'radial-gradient(ellipse at top right, rgba(241,127,178,0.22) 0%, transparent 58%)',
            'radial-gradient(ellipse at bottom left, rgba(56,128,61,0.16) 0%, transparent 58%)',
          ].join(', '),
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="flex min-h-screen flex-col">
          <Suspense fallback={null}>
            <TopNav sessionDepartment={sessionDepartment} departmentLabels={departmentLabels} />
          </Suspense>
          <main className="flex-1 px-4 py-6 md:px-12 md:py-10">{children}</main>
        </div>
      </body>
    </html>
  )
}
