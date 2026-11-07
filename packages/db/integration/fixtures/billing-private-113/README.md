# Private Billing113 SQL regression fixtures

These are exact immutable SQL bytes from Billing6a56ee944fda4490548d9ac4603634901b0e6b33.
They are test inputs for historical execution-version/guard regressions only, not
migrations, canonical main99 proof, an old-slot bridge or authority to apply them
to retained data. The actual canonical transition is tested separately from populated
main99. Final current guard tests load the canonical migration body. No snapshots
or migration journal are duplicated here. The source commit retains all original
SQL/snapshot history and proof attribution.
