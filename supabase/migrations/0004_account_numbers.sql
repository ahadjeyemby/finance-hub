-- Audit: more than one number per account. A card is reissued, an account number changes, a debit or credit card belongs to a checking account:
-- all of them are the same account. The main number stays in accounts.last4; the rest are listed here as
-- [{"last4": "1234", "kind": "replaced", "note": "new card after the fraud alert"}], kind = account | credit_card | debit_card | replaced | other.
-- Run after 0003. Safe to run twice. Moves no data.
alter table public.accounts add column if not exists extra_numbers jsonb not null default '[]'::jsonb;
