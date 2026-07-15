-- Lets a shift row carry a bookkeeper-provided total directly instead of
-- being derived from start/end times + a meal checkbox. Needed for
-- hostess_bar's weekly sheets: the paper timesheet already has a computed
-- NET HOUR and MEAL DED total per employee for the week, so the OCR reads
-- those numbers directly rather than reconstructing them from fuzzy
-- handwritten per-day clock times (which turned out to be unreliable).
-- Null on every existing/servers_bus row — those keep computing from
-- start_time/end_time/meal_provided exactly as before.
alter table shifts add column if not exists net_minutes_override integer;
alter table shifts add column if not exists meal_deduction_override numeric(8,2);
