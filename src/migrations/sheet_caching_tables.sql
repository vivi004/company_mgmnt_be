-- Google Sheets Caching & Billing Protection Tables Migration

-- 1. Create Google Sheets validated rates cache
CREATE TABLE IF NOT EXISTS sheet_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_name VARCHAR(100) NOT NULL UNIQUE,
    rate DECIMAL(10, 2) NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_valid TINYINT DEFAULT 1
);

-- Index to query validated rates in milliseconds
CREATE INDEX idx_sheet_cache_valid ON sheet_cache(is_valid, product_name);

-- 2. Create Invoice Rate Snapshot (Billing Protection)
CREATE TABLE IF NOT EXISTS invoice_rate_snapshot (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    product_id VARCHAR(50) NOT NULL,
    rate DECIMAL(10, 2) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_bill_product (bill_id, product_id)
);

CREATE INDEX idx_invoice_rate_snapshot_bill ON invoice_rate_snapshot(bill_id);
