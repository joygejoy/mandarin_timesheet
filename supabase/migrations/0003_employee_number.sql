-- Add employee_number column (nullable int, unique when set)
alter table employees add column if not exists employee_number int;
create unique index if not exists employees_employee_number_uniq
  on employees (employee_number) where employee_number is not null;
