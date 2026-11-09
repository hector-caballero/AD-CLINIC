-- =============================================================================
-- AD Clinic · Estado de cita `reschedule_requested`
-- -----------------------------------------------------------------------------
-- El recordatorio de WhatsApp (src/services/whatsapp.ts) pide al paciente
-- responder *1* para confirmar o *2* para reagendar. El webhook de Evolution API
-- (`supabase/functions/whatsapp-webhook`) traduce el *2* a este estado, que
-- recepción ve en la agenda como «Reagendar» y resuelve llamando al paciente.
--
-- Va en un archivo aparte a propósito: Postgres no permite *usar* un valor nuevo
-- de un enum dentro de la misma transacción en la que se crea, y las migraciones
-- siguientes ya lo usan en sus funciones y políticas.
-- =============================================================================

alter type public.appointment_status add value if not exists 'reschedule_requested';
