import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Sidebar } from './_components/Sidebar'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Mandarin Timesheet',
  description: 'Scan, review, and roll up restaurant payroll.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[color:var(--background)] text-[color:var(--foreground)]">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 px-6 py-8 md:px-12 md:py-10">{children}</main>
        </div>
      </body>
    </html>
  )
}
