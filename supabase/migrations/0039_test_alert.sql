-- Kopor 0039: a "test" alert kind, so the owner can check that notifications reach their phones (Maintenance →
-- test-notification). It says plainly that it is a test.
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund', 'approval', 'newDevice', 'test'));
