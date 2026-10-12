-- Every channel creator gets its stream row in the creating transaction.
CREATE FUNCTION public.daisy_messaging_channel_stream_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $channel_stream_created$
BEGIN
  INSERT INTO public.messaging_channel_streams(channel_id) VALUES (NEW.id);
  RETURN NULL;
END;
$channel_stream_created$;
REVOKE ALL ON FUNCTION public.daisy_messaging_channel_stream_created() FROM PUBLIC;
CREATE TRIGGER daisy_messaging_channel_stream_created AFTER INSERT ON public.messaging_channels
  FOR EACH ROW EXECUTE FUNCTION public.daisy_messaging_channel_stream_created();
