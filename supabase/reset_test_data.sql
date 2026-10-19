-- RESET FOR TESTING ONLY. Run this by hand in the Supabase SQL editor. Nothing in the app calls it.
-- It deletes every statement, transaction, receipt, link and saved decision for YOUR user so you can reimport from scratch.
-- It does not touch your sign-in. Files in the 'receipts' and 'statements' storage buckets are not removed by SQL:
-- empty them in Dashboard > Storage if you want them gone (re-uploading the same file overwrites it, so leaving them is harmless).
--
-- After running it, also clear this site's data in your browser (or the app's stored data on your phone). The app keeps its own copy of your
-- decisions and would otherwise upload it again on the next sync.

begin;
delete from public.receipt_links where user_id = auth.uid();
delete from public.link_flags    where user_id = auth.uid();
delete from public.txn_raw       where user_id = auth.uid();
delete from public.statements    where user_id = auth.uid();
delete from public.receipts      where user_id = auth.uid();
delete from public.txns          where user_id = auth.uid();
delete from public.accounts      where user_id = auth.uid();
delete from public.overlays      where user_id = auth.uid();
commit;
