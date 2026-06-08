-- Add shift_type to daily_sheets so lunch/dinner scans can be labelled
alter table daily_sheets add column if not exists shift_type text
  check (shift_type in ('lunch', 'dinner'));
