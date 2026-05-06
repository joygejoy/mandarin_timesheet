import 'server-only'
import { google, type sheets_v4 } from 'googleapis'
import type { BiweeklySummary } from '@/lib/payroll'

/**
 * Google Sheets integration. Uses a **service account** for auth — the
 * manager creates a Google Cloud service account, downloads the JSON key,
 * shares the target spreadsheet with the service account's email
 * (`client_email`), then sets two env vars:
 *
 *   GOOGLE_SHEETS_CREDENTIALS_JSON  — the entire service account JSON
 *                                     blob, on one line, as a string
 *   GOOGLE_SHEETS_SPREADSHEET_ID    — the ID of the target spreadsheet
 *                                     (the long token in its URL)
 */

export class GoogleSheetsNotConfiguredError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Google Sheets is not configured. Set GOOGLE_SHEETS_CREDENTIALS_JSON and GOOGLE_SHEETS_SPREADSHEET_ID in .env.local. See AGENT-REPORT.md for setup steps.'
    )
    this.name = 'GoogleSheetsNotConfiguredError'
  }
}

type ServiceAccountCredentials = {
  client_email: string
  private_key: string
  // Other fields exist (project_id, token_uri, etc.) but only these two are needed for JWT auth.
}

function parseCredentials(raw: string): ServiceAccountCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GoogleSheetsNotConfiguredError(
      'GOOGLE_SHEETS_CREDENTIALS_JSON is not valid JSON. Paste the entire service account JSON file as a single-line string.'
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new GoogleSheetsNotConfiguredError(
      'GOOGLE_SHEETS_CREDENTIALS_JSON must be a JSON object with client_email and private_key.'
    )
  }
  const obj = parsed as Record<string, unknown>
  const client_email = typeof obj.client_email === 'string' ? obj.client_email : ''
  let private_key = typeof obj.private_key === 'string' ? obj.private_key : ''
  if (!client_email || !private_key) {
    throw new GoogleSheetsNotConfiguredError(
      'GOOGLE_SHEETS_CREDENTIALS_JSON is missing client_email or private_key.'
    )
  }
  // When env vars are pasted on one line, embedded "\n" becomes the literal
  // two characters backslash+n. Convert back to real newlines so the JWT lib
  // can read the PEM.
  if (private_key.includes('\\n')) {
    private_key = private_key.replace(/\\n/g, '\n')
  }
  return { client_email, private_key }
}

/** Cheap probe — true if both env vars are set (does not validate JSON). */
export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_CREDENTIALS_JSON?.trim() &&
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
  )
}

/** Build an authenticated Sheets API client. Throws if env is missing. */
export function getSheetsClient(): sheets_v4.Sheets {
  const credsRaw = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!credsRaw || !spreadsheetId) {
    throw new GoogleSheetsNotConfiguredError()
  }
  const creds = parseCredentials(credsRaw)
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

export function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!id) throw new GoogleSheetsNotConfiguredError()
  return id
}

// ---- Tab name helpers -----------------------------------------------------

/** Sheet/tab title can't exceed 100 chars or contain `[]:?*\\/'`. */
function sanitizeTabName(name: string): string {
  return name.replace(/[\[\]:\\?*\/']/g, '-').slice(0, 95)
}

export function buildTabName(start: string, end: string): string {
  return sanitizeTabName(`Payroll ${start} to ${end}`)
}

// ---- Append a payroll summary as a new tab --------------------------------

export type PushResult = {
  tabName: string
  spreadsheetId: string
  url: string
}

/**
 * Add a new tab to the configured spreadsheet, populated with header row,
 * one row per employee, and a totals row. If a tab with the same base name
 * already exists, a numeric suffix (`(2)`, `(3)`, …) is appended.
 */
export async function pushBiweeklySummary(opts: {
  startDate: string
  endDate: string
  summary: BiweeklySummary
}): Promise<PushResult> {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()
  const baseTabName = buildTabName(opts.startDate, opts.endDate)

  // Look up existing tab titles so we can pick a non-colliding name.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)',
  })
  const existingTitles = new Set(
    (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => typeof t === 'string')
  )
  const tabName = uniqueTabName(baseTabName, existingTitles)

  // Create the tab.
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: tabName },
          },
        },
      ],
    },
  })
  const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId

  // Build the row payload.
  const headerRow = [
    'Employee',
    'Hourly rate',
    'Shifts',
    'Hours',
    'Gross pay',
    'Alcohol points',
  ]
  const employeeRows = opts.summary.rows.map((r) => [
    r.employee_name,
    r.hourly_rate.toFixed(2),
    r.shift_count.toString(),
    r.total_hours.toFixed(2),
    r.gross_pay.toFixed(2),
    r.alcohol_points.toString(),
  ])
  const totalsRow = [
    'TOTAL',
    '',
    '',
    opts.summary.total_hours.toFixed(2),
    opts.summary.total_pay.toFixed(2),
    opts.summary.total_alcohol_points.toString(),
  ]
  const titleRow = [`Mandarin Timesheet — ${opts.startDate} to ${opts.endDate}`]
  const values: (string | number)[][] = [
    titleRow,
    [], // blank spacer row
    headerRow,
    ...employeeRows,
    totalsRow,
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  })

  // Best-effort formatting: bold the title + header row, freeze the header.
  if (typeof newSheetId === 'number') {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: newSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: headerRow.length,
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: newSheetId,
                  startRowIndex: 2,
                  endRowIndex: 3,
                  startColumnIndex: 0,
                  endColumnIndex: headerRow.length,
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: newSheetId,
                  gridProperties: { frozenRowCount: 3 },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      })
    } catch {
      // Formatting failures are non-fatal; the data is already there.
    }
  }

  const url =
    typeof newSheetId === 'number'
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${newSheetId}`
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return { tabName, spreadsheetId, url }
}

function uniqueTabName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = sanitizeTabName(`${base} (${i})`)
    if (!existing.has(candidate)) return candidate
  }
  // Fallback — extremely unlikely.
  return sanitizeTabName(`${base} ${Date.now()}`)
}
