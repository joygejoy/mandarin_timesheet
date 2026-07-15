-- Lets a single shifts row remember which actual calendar day it happened on,
-- independent of its parent daily_sheets.sheet_date. Needed for hostess_bar's
-- weekly sheets (one daily_sheets row spans a whole week; each shift inside
-- it needs its own day). Servers/bus shifts leave this null — their date is
-- implicitly the parent sheet's sheet_date, exactly as before.
alter table shifts add column if not exists work_date date;
