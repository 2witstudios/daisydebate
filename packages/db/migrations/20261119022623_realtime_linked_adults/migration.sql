-- ADR 0155: the realtime server tells whether a Round's Room is in the Youth
-- lobby (ADR 0156) before it reads anyone's links. `rooms` is exempt from the
-- tenant manifest by name (ADR 0129 §6), so one column-level grant does it.
-- The linked-adult read itself touches tenant-owned tables, which the realtime
-- role may never read (ADR 0129 §4); it stays out of this migration.
GRANT SELECT (division) ON public.rooms TO daisy_realtime;
