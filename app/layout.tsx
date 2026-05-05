import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Mandarin Timesheet',
  description: 'Scan, review, and roll up restaurant payroll.',
}

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/scan', label: 'Scan sheet' },
  { href: '/shifts', label: 'Daily shifts' },
  { href: '/alcohol', label: 'Alcohol sales' },
  { href: '/payroll', label: 'Payroll' },
  { href: '/employees', label: 'Employees' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white p-4 md:block dark:border-zinc-800 dark:bg-zinc-900">
            <Link href="/" className="block px-2 pb-6 text-base font-semibold tracking-tight">
              Mandarin <span className="text-zinc-400">timesheet</span>
            </Link>
            <nav className="flex flex-col gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-6 md:p-10">{children}</main>
        </div>
      </body>
    </html>
  )
}
