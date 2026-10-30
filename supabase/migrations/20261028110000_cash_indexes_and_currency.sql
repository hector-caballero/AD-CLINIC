-- =============================================================================
-- AD Clinic · Caja y finanzas
-- -----------------------------------------------------------------------------
-- 1. Moneda por defecto: la clínica opera en guaraníes (PYG).
--    No modifica filas existentes; los movimientos nuevos que no envíen
--    `currency` quedan en PYG.
-- 2. Índices para el historial de caja:
--    - `transactions_created_at_idx`: historial por período (ORDER BY created_at).
--    - `transactions_paid_at_idx`: métricas de «Cobrado hoy/mes» (pagos paid).
--
-- Re-ejecutable (ALTER/COMMENT/INDEX IF NOT EXISTS).
-- =============================================================================

alter table public.transactions
  alter column currency set default 'PYG';

comment on column public.transactions.currency is
  'Moneda ISO 4217 del movimiento. La clínica opera en guaraníes (PYG).';


create index if not exists transactions_created_at_idx
  on public.transactions (created_at desc);

create index if not exists transactions_paid_at_idx
  on public.transactions (paid_at desc)
  where type = 'payment' and status = 'paid';


-- Recargar la caché de esquema de PostgREST (Supabase API)
notify pgrst, 'reload schema';
