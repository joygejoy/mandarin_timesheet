import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, isSessionUserActive, verifyEdgeSession } from '@/lib/session-edge'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await verifyEdgeSession(token)

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (!(await isSessionUserActive(session.userId))) {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete(SESSION_COOKIE_NAME)
    return res
  }

  if (session.pending && pathname !== '/set-password') {
    return NextResponse.redirect(new URL('/set-password', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next|login|set-password).*)'],
}
