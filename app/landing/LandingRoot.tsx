'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  ink:       '#0d1b2a',
  inkSoft:   '#162537',
  inkLift:   '#1e3048',
  paper:     '#fdf7ed',
  paperDim:  '#f0e8d8',
  paperBord: '#e0d4bf',
  amber:     '#e8a833',
  amberDim:  '#c48a1a',
  mist:      '#8fa3b8',
  mistDark:  '#4a6278',
  okGreen:   '#2a8a5a',
} as const

// ─── Fonts ────────────────────────────────────────────────────────────────────
const SERIF = "'Playfair Display', Georgia, serif"
const SANS  = "'DM Sans', system-ui, -apple-system, sans-serif"
const MONO  = "'Courier New', Courier, monospace"

// ─── CSS ─────────────────────────────────────────────────────────────────────
const KEYFRAMES = `
  .landing *, .landing *::before, .landing *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes scanBeam {
    0%   { transform: translateY(0px); opacity: 0; }
    6%   { opacity: 1; }
    88%  { transform: translateY(148px); opacity: 1; }
    100% { transform: translateY(148px); opacity: 0; }
  }
  @keyframes rowHighlight {
    0%,38%  { background: transparent; border-left: 2px solid transparent; }
    50%     { background: rgba(232,168,51,0.13); border-left: 2px solid #e8a833; }
    100%    { background: rgba(232,168,51,0.09); border-left: 2px solid #e8a833; }
  }
  @keyframes rowIn {
    from { opacity: 0; transform: translateX(-6px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulseAmber {
    0%,100% { opacity: 0.4; }
    50%     { opacity: 1; }
  }
  @keyframes checkPop {
    0%  { transform: scale(0); opacity: 0; }
    60% { transform: scale(1.2); }
    100%{ transform: scale(1); opacity: 1; }
  }
  @keyframes rowBlink {
    0%,100% { background: rgba(232,168,51,0.06); }
    50%     { background: rgba(232,168,51,0.16); }
  }

  .reveal {
    opacity: 0;
    transform: translateY(22px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .reveal.visible { opacity: 1; transform: none; }
  .rd1 { transition-delay: 0.08s; }
  .rd2 { transition-delay: 0.16s; }
  .rd3 { transition-delay: 0.24s; }

  .btn-cta {
    display: inline-block;
    background: ${C.amber};
    color: ${C.ink};
    font-family: ${SANS};
    font-size: 0.9375rem;
    font-weight: 700;
    padding: 0.8rem 2rem;
    text-decoration: none;
    letter-spacing: -0.01em;
    border: none;
    cursor: pointer;
    transition: background 0.18s ease, transform 0.1s ease;
  }
  .btn-cta:hover  { background: ${C.amberDim}; }
  .btn-cta:active { transform: translateY(1px); }

  .btn-nav {
    display: inline-block;
    background: ${C.paperDim};
    color: ${C.ink};
    font-family: ${SANS};
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.375rem 0.875rem;
    text-decoration: none;
    letter-spacing: -0.01em;
    transition: background 0.15s ease;
  }
  .btn-nav:hover { background: ${C.paper}; }

  .feat-card {
    position: relative;
    overflow: hidden;
    background: ${C.paper};
    padding: 1.75rem;
    transition: background 0.2s ease;
  }
  .feat-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 2px; height: 0;
    background: ${C.amber};
    transition: height 0.35s ease;
  }
  .feat-card:hover::before { height: 100%; }
  .feat-card:hover { background: ${C.paperDim}; }

  .uc-card {
    background: ${C.inkSoft};
    border: 1px solid rgba(143,163,184,0.12);
    padding: 1.5rem;
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .uc-card:hover {
    border-color: rgba(232,168,51,0.28);
    background: ${C.inkLift};
  }

  .scan-wrap { overflow-x: auto; }

  @media (max-width: 600px) {
    .extract-panel { display: none !important; }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    * { animation-duration: 0.01ms !important; }
  }
`

// ─── Mock data ────────────────────────────────────────────────────────────────
const PAPER_ROWS = [
  { emp: 'Ashwin S.',  inT: '9:00',  outT: '17:00', hrs: '8.0', flag: false },
  { emp: 'Bonita R.',  inT: '10:30', outT: '6:3?',  hrs: '???', flag: true  },
  { emp: 'Chen W.',    inT: '9:00',  outT: '15:30', hrs: '6.5', flag: false },
  { emp: 'Diana M.',   inT: '11:00', outT: '19:00', hrs: '8.0', flag: false },
]
const EXTRACT_ROWS = [
  { name: 'Ashwin S.',  times: '9:00 – 17:00 · 8.0 hrs',   status: 'OK'     },
  { name: 'Bonita R.',  times: '10:30 – ?? · uncertain',    status: 'REVIEW' },
  { name: 'Chen W.',    times: '9:00 – 15:30 · 6.5 hrs',   status: 'OK'     },
  { name: 'Diana M.',   times: '11:00 – 19:00 · 8.0 hrs',  status: 'OK'     },
]

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: <ScanIcon />,     title: 'AI-Powered OCR',        body: 'GPT-4o reads handwritten timesheets. Every name, every punch, every break — with a confidence score on each extracted field.' },
  { icon: <PeopleIcon />,   title: 'Employee Roster',       body: 'Add staff one at a time or bulk-import from a photo of the employee list, a PDF, or an Excel spreadsheet.' },
  { icon: <CalendarIcon />, title: 'Biweekly Pay Periods',  body: 'Approved daily sheets roll up automatically. View per-employee hours, meal deductions, and net pay at any point in the period.' },
  { icon: <ChartIcon />,    title: 'Drink Leaderboard',     body: 'Log alcohol drink-point sales per server. A live podium resets at the close of each pay period.' },
]

// ─── Use cases ────────────────────────────────────────────────────────────────
const USE_CASES = [
  { title: 'Shift sheet scanning',   body: "Handles Mandarin's multi-column sign-in format — meals, initials, and break columns included." },
  { title: 'Ontario payroll ready',  body: 'Defaults to Ontario minimum wage, $2/shift meal deductions, and ESA-aligned time rounding.' },
  { title: 'Server drink tracking',  body: 'Drink-point sales tracked alongside pay totals. Podium leaderboard appears at each period close.' },
  { title: 'Export-ready summaries', body: 'CSV and PDF output formatted for payroll entry. No manual spreadsheet work at the end of every period.' },
]

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function LandingRoot() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.12 }
    )
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <div
      className="landing -mx-4 -my-6 md:-mx-12 md:-my-10"
      style={{ background: C.ink, color: C.paper, fontFamily: SANS, lineHeight: '1.6', minHeight: '100vh' }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      <Nav />
      <HeroSection />
      <StepsSection />
      <FeaturesSection />
      <UseCasesSection />
      <Footer />
    </div>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 20,
      background: 'rgba(10,21,37,0.92)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ maxWidth: 1140, margin: '0 auto', padding: '0 1.5rem' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: '0.9375rem', color: C.paperDim, letterSpacing: '-0.02em' }}>
            Mandarin Tally
          </span>
          <Link href="/login" className="btn-nav">Sign in</Link>
        </div>
      </div>
    </nav>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section style={{
      background: C.ink,
      backgroundImage: `radial-gradient(ellipse 80% 40% at 50% -5%, rgba(232,168,51,0.07), transparent)`,
      padding: '5.5rem 1.5rem 0',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <p style={{
          fontFamily: SANS, fontSize: '0.6875rem', fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: C.amber,
          marginBottom: '1.75rem',
          animation: 'fadeSlideUp 0.55s ease both',
        }}>
          Photograph · Extract · Approve
        </p>
        <h1 style={{
          fontFamily: SERIF,
          fontSize: 'clamp(2.5rem, 5.5vw, 4.25rem)',
          fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em',
          color: C.paperDim, marginBottom: '1.375rem',
          animation: 'fadeSlideUp 0.55s 0.08s ease both',
        }}>
          Your paper sign-in sheet,<br />calculated in seconds.
        </h1>
        <p style={{
          fontSize: 'clamp(0.9375rem, 1.8vw, 1.0625rem)', color: C.mist,
          maxWidth: 460, margin: '0 auto 2.75rem', lineHeight: 1.78,
          animation: 'fadeSlideUp 0.55s 0.16s ease both',
        }}>
          Photograph the day's timesheet. The AI reads every punch. Review, approve, and export — biweekly payroll done.
        </p>
        <div style={{ animation: 'fadeSlideUp 0.55s 0.24s ease both' }}>
          <Link href="/login" className="btn-cta">Sign in to get started →</Link>
        </div>
      </div>

      {/* Scan mockup */}
      <div style={{
        maxWidth: 960, margin: '4rem auto 0',
        animation: 'fadeSlideUp 0.7s 0.4s ease both',
      }}>
        <ScanMockup />
      </div>
    </section>
  )
}

// ─── Scan mockup ──────────────────────────────────────────────────────────────
function ScanMockup() {
  return (
    <div className="scan-wrap">
      <div style={{
        minWidth: 560,
        background: '#111d2e',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)',
      }}>
        {/* Browser chrome */}
        <div style={{
          background: '#0a1625',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '0.6rem 1rem',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['#ff5f57','#ffbd2e','#28ca41'].map((bg, i) => (
              <span key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: bg, opacity: 0.75, flexShrink: 0 }} />
            ))}
          </div>
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 3,
            padding: '0.2rem 0.75rem', fontFamily: MONO, fontSize: '0.625rem',
            color: 'rgba(255,255,255,0.28)', textAlign: 'center',
          }}>
            app.mandarin-timesheet.ca / review / jun-24
          </div>
        </div>

        {/* Split content */}
        <div style={{ display: 'flex', minHeight: 248 }}>

          {/* Paper panel */}
          <div style={{
            flex: 1, minWidth: 0,
            background: C.paper,
            backgroundImage: 'repeating-linear-gradient(180deg, transparent, transparent 37px, rgba(13,27,42,0.07) 37px, rgba(13,27,42,0.07) 38px)',
            backgroundPosition: '0 76px',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Panel label */}
            <div style={{
              background: '#0a1625', borderBottom: '1px solid rgba(13,27,42,0.2)',
              padding: '0.4rem 1rem',
            }}>
              <span style={{ fontFamily: MONO, fontSize: '0.5625rem', color: C.mist, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Daily Timesheet · Jun 24
              </span>
            </div>
            {/* Column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1.9fr 1fr 1fr 0.75fr',
              padding: '0.35rem 1rem',
              borderBottom: '1px solid rgba(13,27,42,0.13)',
            }}>
              {['EMPLOYEE','IN','OUT','HRS'].map(h => (
                <span key={h} style={{ fontFamily: MONO, fontSize: '0.5625rem', color: C.mistDark, letterSpacing: '0.08em' }}>{h}</span>
              ))}
            </div>
            {/* Data rows */}
            {PAPER_ROWS.map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'grid', gridTemplateColumns: '1.9fr 1fr 1fr 0.75fr',
                  padding: '0.55rem 1rem',
                  borderBottom: '1px solid rgba(13,27,42,0.06)',
                  borderLeft: '2px solid transparent',
                  animation: row.flag ? 'rowHighlight 3s 1.2s ease both' : undefined,
                }}
              >
                {[row.emp, row.inT, row.outT, row.hrs].map((cell, j) => (
                  <span key={j} style={{
                    fontFamily: MONO, fontSize: '0.6875rem',
                    color: row.flag && (j === 2 || j === 3) ? C.amberDim : C.ink,
                    fontWeight: row.flag && (j === 2 || j === 3) ? 700 : 400,
                  }}>
                    {cell}
                  </span>
                ))}
              </div>
            ))}
            {/* Scan beam */}
            <div aria-hidden style={{
              position: 'absolute', left: 0, right: 0, top: 76, height: 2,
              background: `linear-gradient(90deg, transparent 5%, ${C.amber} 40%, ${C.amber} 60%, transparent 95%)`,
              opacity: 0.9,
              animation: 'scanBeam 3s 0.8s ease-in-out both',
              pointerEvents: 'none',
              boxShadow: `0 0 8px ${C.amber}`,
            }} />
          </div>

          {/* Extract panel */}
          <div className="extract-panel" style={{
            width: 260, flexShrink: 0,
            background: '#111d2e',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '0.4rem 1rem',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}>
              <span style={{ fontFamily: MONO, fontSize: '0.5625rem', color: C.amber, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                AI Extraction
              </span>
            </div>
            <div style={{ flex: 1 }}>
              {EXTRACT_ROWS.map((row, i) => {
                const isReview = row.status === 'REVIEW'
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.55rem 1rem',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: isReview ? 'rgba(232,168,51,0.05)' : 'transparent',
                    opacity: 0,
                    animation: `rowIn 0.4s ${1.4 + i * 0.22}s ease both`,
                  }}>
                    <div>
                      <p style={{ fontFamily: MONO, fontSize: '0.6875rem', color: C.paperDim, marginBottom: 2 }}>{row.name}</p>
                      <p style={{ fontFamily: MONO, fontSize: '0.5625rem', color: C.mist }}>{row.times}</p>
                    </div>
                    <span style={{
                      fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700,
                      letterSpacing: '0.06em', padding: '0.2rem 0.5rem',
                      background: isReview ? 'rgba(232,168,51,0.15)' : 'rgba(42,138,90,0.15)',
                      color: isReview ? C.amber : C.okGreen,
                      border: `1px solid ${isReview ? 'rgba(232,168,51,0.3)' : 'rgba(42,138,90,0.3)'}`,
                    }}>
                      {row.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────
function StepsSection() {
  return (
    <section style={{ background: C.paper, color: C.ink, padding: '6rem 1.5rem 5.5rem' }}>
      <div style={{ maxWidth: 1140, margin: '0 auto' }}>
        <p className="reveal" style={{
          fontFamily: SANS, fontSize: '0.6875rem', fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: C.amberDim, textAlign: 'center', marginBottom: '0.5rem',
        }}>How it works</p>
        <h2 className="reveal" style={{
          fontFamily: SERIF, fontSize: 'clamp(1.875rem, 3.5vw, 2.875rem)',
          fontWeight: 700, letterSpacing: '-0.03em',
          color: C.ink, textAlign: 'center', marginBottom: '4rem',
        }}>Three steps. Zero spreadsheets.</h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '2rem',
        }}>
          <StepCard
            delay={0}
            phase="PHOTOGRAPH"
            title="Photograph the sheet"
            body="End of service — snap a photo of the day's sign-in sheet and upload. JPG, PNG, or HEIC."
            illustration={<Step1Illus />}
          />
          <StepCard
            delay={0.1}
            phase="EXTRACT & REVIEW"
            title="AI reads every punch"
            body="GPT-4o reads every name, time, and break. Uncertain cells are flagged for your review."
            illustration={<Step2Illus />}
          />
          <StepCard
            delay={0.2}
            phase="APPROVE & EXPORT"
            title="Download and done"
            body="Approve the day. Totals roll up by employee. Download your biweekly pay summary when ready."
            illustration={<Step3Illus />}
          />
        </div>
      </div>
    </section>
  )
}

function StepCard({ delay, phase, title, body, illustration }: {
  delay: number; phase: string; title: string; body: string; illustration: React.ReactNode
}) {
  return (
    <div
      className="reveal"
      style={{
        background: C.paperDim,
        border: `1px solid ${C.paperBord}`,
        padding: '2rem',
        display: 'flex', flexDirection: 'column',
        transitionDelay: `${delay}s`,
      }}
    >
      <p style={{
        fontFamily: SANS, fontSize: '0.5625rem', fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: C.amber, marginBottom: '0.75rem',
      }}>{phase}</p>
      <h3 style={{
        fontFamily: SERIF, fontWeight: 700, fontSize: '1.25rem',
        color: C.ink, marginBottom: '0.625rem', letterSpacing: '-0.02em', lineHeight: 1.25,
      }}>{title}</h3>
      <p style={{ color: C.mistDark, fontSize: '0.875rem', lineHeight: 1.7, flex: 1 }}>{body}</p>
      {illustration}
    </div>
  )
}

// ─── Step illustrations ────────────────────────────────────────────────────────
function Step1Illus() {
  return (
    <div style={{ marginTop: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, height: 72 }}>
      {/* Phone */}
      <div style={{
        width: 34, height: 52, border: `2px solid ${C.ink}`, borderRadius: 4,
        background: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <div style={{ width: 14, height: 12, border: `1.5px solid ${C.amber}`, borderRadius: '50%' }} />
      </div>
      {/* Animated dots */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {[0, 0.15, 0.3, 0.45].map(d => (
          <div key={d} style={{
            width: 6, height: 6, borderRadius: '50%', background: C.amber,
            animation: `pulseAmber 1.4s ${d}s ease-in-out infinite`,
          }} />
        ))}
      </div>
      {/* Document */}
      <div style={{
        width: 44, height: 58, background: C.paper,
        border: `1px solid ${C.paperBord}`, flexShrink: 0,
        backgroundImage: 'repeating-linear-gradient(180deg, transparent, transparent 7px, rgba(13,27,42,0.12) 7px, rgba(13,27,42,0.12) 8px)',
        backgroundPosition: '0 14px',
      }} />
    </div>
  )
}

function Step2Illus() {
  const rows = [
    { name: 'Ashwin S.', ok: true },
    { name: 'Bonita R.', ok: false },
    { name: 'Chen W.',   ok: true },
  ]
  return (
    <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'center', height: 72, alignItems: 'center' }}>
      <div style={{
        width: '100%', maxWidth: 200,
        border: `1px solid ${C.paperBord}`,
        overflow: 'hidden',
        fontFamily: MONO,
      }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.35rem 0.625rem',
            borderBottom: i < 2 ? `1px solid ${C.paperBord}` : undefined,
            background: r.ok ? C.paper : 'transparent',
            animation: !r.ok ? 'rowBlink 2s ease-in-out infinite' : undefined,
          }}>
            <span style={{ fontSize: '0.5625rem', color: C.ink }}>{r.name}</span>
            <span style={{ fontSize: '0.5rem', fontWeight: 700, color: r.ok ? C.okGreen : C.amber }}>
              {r.ok ? 'OK' : 'REVIEW'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Step3Illus() {
  return (
    <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'center', height: 72, alignItems: 'center' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 18px)', gap: 4 }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} style={{
            width: 18, height: 18,
            background: C.paper,
            border: `1px solid ${C.okGreen}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: `checkPop 0.3s ${0.3 + i * 0.07}s ease both`,
          }}>
            <span style={{ fontSize: '0.5625rem', color: C.okGreen, fontWeight: 700, lineHeight: 1 }}>✓</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────
function FeaturesSection() {
  return (
    <section style={{ background: C.paper, color: C.ink, padding: '0 1.5rem 6rem' }}>
      <div style={{ maxWidth: 1140, margin: '0 auto' }}>
        <div style={{ height: 1, background: C.paperBord, marginBottom: '5.5rem' }} />
        <p className="reveal" style={{
          fontFamily: SANS, fontSize: '0.6875rem', fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: C.amberDim, textAlign: 'center', marginBottom: '0.5rem',
        }}>Features</p>
        <h2 className="reveal" style={{
          fontFamily: SERIF, fontSize: 'clamp(1.875rem, 3.5vw, 2.875rem)',
          fontWeight: 700, letterSpacing: '-0.03em',
          color: C.ink, textAlign: 'center', marginBottom: '3rem',
        }}>Built for this, not adapted to it</h2>
        {/* 1px-border grid trick */}
        <div className="reveal" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 1,
          background: C.paperBord,
          border: `1px solid ${C.paperBord}`,
        }}>
          {FEATURES.map((f, i) => (
            <div key={i} className="feat-card">
              <div style={{
                width: 44, height: 44,
                background: C.ink,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '1.125rem',
                color: C.amber, flexShrink: 0,
              }}>
                {f.icon}
              </div>
              <h3 style={{
                fontFamily: SERIF, fontWeight: 700, fontSize: '1.0625rem',
                color: C.ink, marginBottom: '0.5rem',
                letterSpacing: '-0.015em', lineHeight: 1.25,
              }}>{f.title}</h3>
              <p style={{ color: C.mistDark, fontSize: '0.875rem', lineHeight: 1.65 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Use cases ────────────────────────────────────────────────────────────────
function UseCasesSection() {
  return (
    <section style={{
      background: C.ink,
      backgroundImage: 'repeating-linear-gradient(180deg, transparent, transparent 27px, rgba(253,247,237,0.03) 27px, rgba(253,247,237,0.03) 28px)',
      padding: '6rem 1.5rem',
    }}>
      <div style={{ maxWidth: 1140, margin: '0 auto' }}>
        <p className="reveal" style={{
          fontFamily: SANS, fontSize: '0.6875rem', fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: C.amber, textAlign: 'center', marginBottom: '0.5rem',
        }}>Use cases</p>
        <h2 className="reveal" style={{
          fontFamily: SERIF, fontSize: 'clamp(1.875rem, 3.5vw, 2.875rem)',
          fontWeight: 700, letterSpacing: '-0.03em',
          color: C.paperDim, textAlign: 'center', marginBottom: '0.875rem',
        }}>Built for Mandarin Buffet</h2>
        <p className="reveal" style={{
          textAlign: 'center', color: C.mist, fontSize: '0.9375rem', lineHeight: 1.75,
          maxWidth: 440, margin: '0 auto 3.5rem',
        }}>
          Designed around the specific workflows and sheet formats used in Mandarin restaurant operations.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}>
          {USE_CASES.map((u, i) => (
            <div key={i} className={`reveal uc-card rd${i % 3 + 1}`}>
              <h3 style={{
                fontFamily: SERIF, fontWeight: 700, fontSize: '1rem',
                color: C.paperDim, marginBottom: '0.4rem', letterSpacing: '-0.01em',
              }}>{u.title}</h3>
              <p style={{ color: C.mist, fontSize: '0.85rem', lineHeight: 1.65 }}>{u.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      background: '#0a1525',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      padding: '1.75rem 1.5rem',
      textAlign: 'center',
    }}>
      <span style={{ fontFamily: SANS, color: C.mistDark, fontSize: '0.75rem', letterSpacing: '0.1em', fontWeight: 500 }}>
        MANDARIN TALLY
      </span>
    </footer>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function ScanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
    </svg>
  )
}
function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="18 20 18 10"/><polyline points="12 20 12 4"/><polyline points="6 20 6 14"/>
    </svg>
  )
}
