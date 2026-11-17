-- Validates users_image_unused, which the folder before added NOT VALID
-- (docs/operations/database.md). No code writes users.image, so a stored row
-- breaking it is not expected; if one exists the constraint stays NOT VALID
-- with a warning, still refusing every new write, until the row is repaired
-- and a later migration validates it. The deploy never refuses on it.
DO $$
BEGIN
  ALTER TABLE public.users VALIDATE CONSTRAINT users_image_unused;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', 'users_image_unused', 'users';
END $$;
