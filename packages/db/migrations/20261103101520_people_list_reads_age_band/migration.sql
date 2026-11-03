-- ADR 0105: the people list reads ADR 0075's admission rule, age included.
-- The function takes birth data in and returns only a band; the web role
-- already reads the age source, so this widens nothing it could see.
GRANT EXECUTE ON FUNCTION public.daisy_age_band(text, integer, timestamptz, timestamptz) TO daisy_web;
