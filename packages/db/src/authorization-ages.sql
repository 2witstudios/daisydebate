CREATE FUNCTION public.daisy_authorization_ages(actor_ids text[],checked_at timestamptz)
RETURNS TABLE("actorId" text,band text,revision integer,"accountRevision" integer,"validUntil" timestamptz)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $authorization_ages$
BEGIN
  IF pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 4096 OR checked_at IS NULL OR NOT pg_catalog.isfinite(checked_at)
    OR EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC') NOT BETWEEN 1000 AND 9999 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid authorization age selector';
  END IF;
  PERFORM 1 FROM public.daisy_authorization_read_accounts(actor_ids);
  RETURN QUERY SELECT a.id,
    CASE WHEN classified.age_months<156 THEN 'under-13' WHEN classified.age_months<192 THEN '13-15' WHEN classified.age_months<216 THEN '16-17' ELSE 'adult' END,
    age_source.version,account.revision,
    (pg_catalog.date_trunc('month',checked_at AT TIME ZONE 'UTC')+INTERVAL '1 month') AT TIME ZONE 'UTC'
  FROM public.actors a
  CROSS JOIN LATERAL public.daisy_authorization_accounts(NULL::text[],a.user_id,false) account
  JOIN public.account_age age_source ON age_source.user_id=account."userId"
  CROSS JOIN LATERAL(SELECT EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC')::integer*12+EXTRACT(MONTH FROM checked_at AT TIME ZONE 'UTC')::integer
    -pg_catalog.split_part(age_source.birth_month,'-',1)::integer*12-pg_catalog.split_part(age_source.birth_month,'-',2)::integer AS age_months) classified
  WHERE a.id=ANY(actor_ids) AND account."actorId"=a.id AND account.member AND NOT account.erased AND age_source.version>0
    AND pg_catalog.isfinite(age_source.recorded_at) AND age_source.recorded_at<=checked_at AND classified.age_months>=0 ORDER BY a.id;
END;
$authorization_ages$;
REVOKE ALL ON FUNCTION public.daisy_authorization_ages(text[],timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_authorization_ages(text[],timestamptz) TO daisy_web,daisy_realtime;
