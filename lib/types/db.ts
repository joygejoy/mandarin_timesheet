// Hand-typed schema mirror. Replace later with `supabase gen types typescript`.

export type Employee = {
  id: string
  full_name: string
  employee_number: number | null
  role: string | null
  hourly_rate: number
  age: number | null
  active: boolean
  default_break_minutes: number
  default_meal_provided: boolean
  notes: string | null
  department: 'servers_bus' | 'hostess_bar'
  tracks_alcohol_points: boolean
  created_at: string
  updated_at: string
}

export type User = {
  id: string
  username: string
  password_hash: string
  display_name: string | null
  department: 'servers_bus' | 'hostess_bar' | 'all'
  must_set_password: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export type PayPeriod = {
  id: string
  start_date: string
  end_date: string
  status: 'open' | 'closed' | 'exported'
  created_at: string
}

export type DailySheet = {
  id: string
  sheet_date: string
  pay_period_id: string | null
  status: 'draft' | 'reviewing' | 'approved'
  shift_type: 'lunch' | 'dinner' | 'both' | null
  scan_image_path: string | null
  notes: string | null
  approved_at: string | null
  approved_by: string | null
  department: 'servers_bus' | 'hostess_bar'
  created_at: string
  updated_at: string
}

export type Shift = {
  id: string
  daily_sheet_id: string
  employee_id: string | null
  employee_name_snapshot: string
  hourly_rate_snapshot: number
  role: string | null
  section: string | null
  start_time: string | null
  end_time: string | null
  break_minutes: number
  meal_provided: boolean
  initials: string | null
  notes: string | null
  department: string | null
  manual_adjustment_minutes: number
  manual_adjustment_reason: string | null
  needs_review: boolean
  review_flags: Record<string, unknown> | null
  source: 'manual' | 'ocr'
  /** 0-based row position from the original sheet/scan. Null for legacy rows. */
  display_order: number | null
  /**
   * The actual calendar day this shift happened, when it differs from the
   * parent daily_sheet's sheet_date — used by hostess_bar's weekly sheets
   * (one sheet row spans 7 days). Null for servers_bus shifts, where the
   * date is implicitly the parent sheet's sheet_date.
   */
  work_date: string | null
  /**
   * When set, this replaces start/end-time-derived hours entirely — used for
   * hostess_bar weekly sheets, where the paper sheet already has a computed
   * NET HOUR total per employee for the week and there's no reliable way to
   * re-derive it from per-day handwritten clock times. Null for ordinary
   * start/end-time shifts.
   */
  net_minutes_override: number | null
  /** Same idea as net_minutes_override, for the sheet's MEAL DED $ total. */
  meal_deduction_override: number | null
  created_at: string
  updated_at: string
}

export type AlcoholSale = {
  id: string
  daily_sheet_id: string
  employee_id: string | null
  employee_name_snapshot: string
  drink_points: number
  revenue: number | null
  notes: string | null
  created_at: string
}
