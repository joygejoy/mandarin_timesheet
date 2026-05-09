-- Preserve the top-to-bottom order in which shifts appear on a scanned daily
-- sheet (or were entered manually). Older rows have a NULL display_order; the
-- query layer falls back to start_time then created_at when this is null, so
-- existing data still sorts sensibly.

alter table shifts add column if not exists display_order int;

create index if not exists shifts_sheet_order_idx
  on shifts (daily_sheet_id, display_order nulls last, start_time nulls last);
