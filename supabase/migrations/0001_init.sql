-- Mandarin Timesheet — complete schema
-- Run once in the Supabase SQL editor to set up a fresh database.

create extension if not exists "uuid-ossp";

-- Employees ------------------------------------------------------------------
create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  employee_number int,
  role text,
  hourly_rate numeric(6,2) not null default 17.50,
  age int,
  active boolean not null default true,
  default_break_minutes int not null default 0,
  default_meal_provided boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_active_idx on employees (active);
create unique index if not exists employees_full_name_lower_uniq
  on employees (lower(full_name)) where active;
create unique index if not exists employees_employee_number_uniq
  on employees (employee_number) where employee_number is not null;

-- Pay periods (biweekly) -----------------------------------------------------
create table if not exists pay_periods (
  id uuid primary key default uuid_generate_v4(),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed','exported')),
  created_at timestamptz not null default now(),
  unique (start_date, end_date)
);

-- Daily sheets (one per calendar day; envelope for shifts + alcohol) --------
create table if not exists daily_sheets (
  id uuid primary key default uuid_generate_v4(),
  sheet_date date not null,
  pay_period_id uuid references pay_periods(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','reviewing','approved')),
  shift_type text check (shift_type in ('lunch', 'dinner')),
  scan_image_path text,           -- supabase storage path of original photo
  notes text,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_date)
);

create index if not exists daily_sheets_period_idx on daily_sheets (pay_period_id);

-- Shifts (one row per employee per day) -------------------------------------
create table if not exists shifts (
  id uuid primary key default uuid_generate_v4(),
  daily_sheet_id uuid not null references daily_sheets(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  -- snapshot fields so historical pay survives employee edits:
  employee_name_snapshot text not null,
  hourly_rate_snapshot numeric(6,2) not null,
  role text,
  section text,
  start_time time,
  end_time time,
  break_minutes int not null default 0,
  meal_provided boolean not null default false,
  initials text,
  notes text,
  display_order int,              -- top-to-bottom order from the scanned sheet
  manual_adjustment_minutes int not null default 0, -- + or -
  manual_adjustment_reason text,
  -- review state from OCR:
  needs_review boolean not null default false,
  review_flags jsonb,            -- {field: "low_confidence"|"missing"|...}
  source text not null default 'manual' check (source in ('manual','ocr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shifts_sheet_idx on shifts (daily_sheet_id);
create index if not exists shifts_employee_idx on shifts (employee_id);
create index if not exists shifts_sheet_order_idx
  on shifts (daily_sheet_id, display_order nulls last, start_time nulls last);

-- Alcohol sales (per employee per day) --------------------------------------
create table if not exists alcohol_sales (
  id uuid primary key default uuid_generate_v4(),
  daily_sheet_id uuid not null references daily_sheets(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  employee_name_snapshot text not null,
  drink_points int not null default 0,    -- tally count
  revenue numeric(8,2),                   -- optional $
  notes text,
  created_at timestamptz not null default now(),
  unique (daily_sheet_id, employee_id)
);

create index if not exists alcohol_sales_sheet_idx on alcohol_sales (daily_sheet_id);

-- OCR extractions (raw payload from OpenAI for audit / re-review) -----------
create table if not exists ocr_extractions (
  id uuid primary key default uuid_generate_v4(),
  daily_sheet_id uuid references daily_sheets(id) on delete cascade,
  image_path text not null,
  model text not null,
  raw_response jsonb not null,
  parsed_rows jsonb,             -- normalized rows shown in review UI
  created_at timestamptz not null default now()
);

create index if not exists ocr_extractions_sheet_idx on ocr_extractions (daily_sheet_id);

-- updated_at trigger ---------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists employees_updated on employees;
create trigger employees_updated before update on employees
  for each row execute function set_updated_at();

drop trigger if exists daily_sheets_updated on daily_sheets;
create trigger daily_sheets_updated before update on daily_sheets
  for each row execute function set_updated_at();

drop trigger if exists shifts_updated on shifts;
create trigger shifts_updated before update on shifts
  for each row execute function set_updated_at();
