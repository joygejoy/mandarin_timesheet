-- Department RBAC: rename departments to neutral codes, enforce per-user
-- write scope, and fix Bartender's department (was miscategorized with
-- Server/Busboy; belongs with Hostess since it's managed/scheduled by the
-- same person).
--
--   foh_service -> servers_bus  (Server, Busboy)
--   front_staff -> hostess_bar  (Hostess, Bartender)
--
-- users.default_department is renamed to users.department: it now backs
-- real server-side write permission checks (lib/permissions.ts), not just a
-- UI default, so the old name would be actively misleading.

-- employees -------------------------------------------------------------------
alter table employees drop constraint if exists employees_department_check;
update employees set department = 'servers_bus' where department = 'foh_service';
update employees set department = 'hostess_bar' where department = 'front_staff';
alter table employees
  add constraint employees_department_check
    check (department in ('servers_bus', 'hostess_bar'));
alter table employees alter column department set default 'servers_bus';

-- Fix the actual miscategorization: Bartender moves to hostess_bar.
update employees set department = 'hostess_bar' where role ilike 'bartender';

-- daily_sheets ------------------------------------------------------------------
alter table daily_sheets drop constraint if exists daily_sheets_department_check;
update daily_sheets set department = 'servers_bus' where department = 'foh_service';
update daily_sheets set department = 'hostess_bar' where department = 'front_staff';
alter table daily_sheets
  add constraint daily_sheets_department_check
    check (department in ('servers_bus', 'hostess_bar'));
alter table daily_sheets alter column department set default 'servers_bus';

-- shifts (plain text column, no check constraint) ------------------------------
update shifts set department = 'servers_bus' where department = 'foh_service';
update shifts set department = 'hostess_bar' where department = 'front_staff';

-- users: default_department -> department, now the enforced permission scope --
alter table users drop constraint if exists users_default_department_check;
alter table users rename column default_department to department;
update users set department = 'servers_bus' where department = 'foh_service';
update users set department = 'hostess_bar' where department = 'front_staff';
alter table users
  add constraint users_department_check
    check (department in ('servers_bus', 'hostess_bar', 'all'));
