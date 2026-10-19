-- RESET FOR TESTING ONLY. Run this by hand in the Supabase SQL editor. Nothing in the app calls it.
-- It deletes EVERY row in these tables: all statements, transactions, receipts, links and saved decisions. This project has one person in it,
-- so nothing is filtered by user (the SQL editor has no signed-in user, so a per-user filter would delete nothing). It does not touch sign-in.
-- Files in the 'receipts' and 'statements' storage buckets are not removed by SQL: empty them in Dashboard > Storage if you want them gone
-- (uploading the same file again overwrites it, so leaving them is harmless).
--
-- After running it, also clear this site's data in your browser (or the app's stored data on your phone). The app keeps its own copy of your
-- decisions and would otherwise upload it again on the next sync.

begin;
delete from public.receipt_links;
delete from public.link_flags;
delete from public.txn_raw;
delete from public.statements;
delete from public.receipts;
delete from public.txns;
delete from public.accounts;
delete from public.overlays;
commit;
