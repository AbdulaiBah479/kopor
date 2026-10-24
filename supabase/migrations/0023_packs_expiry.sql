-- Kopor 0023: stock for pharmacies and provision shops.
--   Cartons: a product can also be sold (and bought) by the carton / pack: pack_size pieces at pack_price.
--   Expiry: a restock can carry the goods' expiry date; the app warns before stock left on the shelf expires.
alter table products add column if not exists pack_size int check (pack_size is null or pack_size between 2 and 10000);
alter table products add column if not exists pack_price bigint check (pack_price is null or pack_price >= 0);
alter table products add column if not exists pack_name text check (pack_name is null or length(pack_name) <= 20);
alter table stock_moves add column if not exists expiry date;
