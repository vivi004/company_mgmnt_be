-- Nisha System Production-Scale Performance Indexes Migration
-- This script creates optimized single and composite indexes on columns frequently used in WHERE, JOIN, ORDER BY, GROUP BY, and SEARCH clauses.
-- These indexes prevent full table scans and keep query responses under 10ms for millions of rows.

-- 1. Shop Transactions Table Indexes
-- Composite index for transaction history / ledger sequential ripple recalculation
CREATE INDEX idx_shop_transactions_shop_date 
ON shop_transactions(shop_id, transaction_date);

-- Composite index for pending administrative approvals filter
CREATE INDEX idx_shop_transactions_approval 
ON shop_transactions(approval_status, transaction_date);

-- 2. Daily Collections Table Indexes
-- Composite index for dashboard order line view
CREATE INDEX idx_daily_collections_ol_date 
ON daily_collections(order_line_id, collection_date);

-- Composite index for sequential ripple balance recalculation
CREATE INDEX idx_daily_collections_shop_date 
ON daily_collections(shop_id, collection_date);

-- 3. Daily Expenses Table Indexes
-- Composite index for expenses dashboard query
CREATE INDEX idx_daily_expenses_ol_date 
ON daily_expenses(order_line_id, expense_date);

-- 4. Bills Table Indexes
-- Composite index for shop bill aggregation and midnight chron checks
CREATE INDEX idx_bills_shop_date 
ON bills(shop_id, delivery_date);

-- Composite index for verified/unverified bill listings
CREATE INDEX idx_bills_status_delivery
ON bills(status, delivery_date);

-- 5. Shops Table Indexes
-- Index for fetching all shops in an order line (village)
CREATE INDEX idx_shops_order_line 
ON shops(order_line_id);

-- 6. Order Lines Table Indexes
-- Index for looking up villages by name (TRIM check)
CREATE INDEX idx_order_lines_name
ON order_lines(name);

-- 7. Product Returns Table Indexes
-- Indexes for daily returns queries and shop-level returns analyses
CREATE INDEX idx_product_returns_shop_date 
ON product_returns(shop_id, return_date);

CREATE INDEX idx_product_returns_date 
ON product_returns(return_date);

-- 8. Shop Transactions Paginated Index
-- Composite index for paginated sequential ledger queries
CREATE INDEX idx_shop_transactions_paginated 
ON shop_transactions(shop_id, transaction_date, id DESC);
