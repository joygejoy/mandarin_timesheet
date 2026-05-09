// Hand-typed schema mirror. Replace later with `supabase gen types typescript`.

export type Employee = {
  id: string
  full_name: string
  role: string | null
  hourly_rate: number
  age: number | null
  active: boolean
  default_break_minutes: number
  default_meal_provided: boolean
  notes: string | null
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
  scan_image_path: string | null
  notes: string | null
  approved_at: string | null
  approved_by: string | null
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
  manual_adjustment_minutes: number
  manual_adjustment_reason: string | null
  needs_review: boolean
  review_flags: Record<string, unknown> | null
  source: 'manual' | 'ocr'
  /** 0-based row position from the original sheet/scan. Null for legacy rows. */
  display_order: number | null
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
