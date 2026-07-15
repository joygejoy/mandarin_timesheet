-- Front Staff department + per-user auth
-- Adds a `users` table for real per-user login, and department /
-- alcohol-tracking columns needed to support front-staff (hostess) shifts
-- alongside the existing FOH service (server/bartender/busboy) shifts.

-- Users -----------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  username text not null,
  password_hash text not null,
  display_name text,
  default_department text not null default 'all'
    check (default_department in ('foh_service','front_staff','all')),
  must_set_password boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_username_lower_uniq
  on users (lower(username)) where active;

drop trigger if exists users_updated on users;
create trigger users_updated before update on users
  for each row execute function set_updated_at();

-- Employees ---------------------------------------------------------------
alter table employees
  add column if not exists department text not null default 'foh_service'
    check (department in ('foh_service','front_staff'));
alter table employees
  add column if not exists tracks_alcohol_points boolean not null default true;

-- Daily sheets --------------------------------------------------------------
alter table daily_sheets
  add column if not exists department text not null default 'foh_service'
    check (department in ('foh_service','front_staff'));

alter table daily_sheets drop constraint if exists daily_sheets_sheet_date_key;
create unique index if not exists daily_sheets_sheet_date_department_uniq
  on daily_sheets (sheet_date, department);

-- Shifts ----------------------------------------------------------------------
alter table shifts
  add column if not exists department text;
