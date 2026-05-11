-- 1. Ensure Bills table has all necessary columns for synchronization
ALTER TABLE bills 
ADD COLUMN IF NOT EXISTS shop_id INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS is_edited_price BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS delivery_date DATETIME DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_applied_to_balance BOOLEAN DEFAULT FALSE;

-- Add index to bills for faster shop-based lookups
CREATE INDEX IF NOT EXISTS idx_bills_shop_id ON bills(shop_id);
CREATE INDEX IF NOT EXISTS idx_bills_delivery_date ON bills(delivery_date);

-- 2. Create the Daily Collections (Dashboard) table if not exists
CREATE TABLE IF NOT EXISTS daily_collections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id INT NOT NULL,
    shop_name VARCHAR(255) NOT NULL,
    village_name VARCHAR(255) NOT NULL,
    order_line_id INT NOT NULL,
    collection_date DATE NOT NULL,

    -- Billing Summary
    todays_bill_amount DECIMAL(12, 2) DEFAULT 0.00,

    -- Payment Collection (supports multi-mode)
    cash_collected DECIMAL(12, 2) DEFAULT 0.00,
    upi_collected DECIMAL(12, 2) DEFAULT 0.00,
    cheque_collected DECIMAL(12, 2) DEFAULT 0.00,

    -- Balances (Mirror of the Shop Ledger)
    old_balance DECIMAL(12, 2) DEFAULT 0.00,
    total_balance DECIMAL(12, 2) DEFAULT 0.00,

    -- Metadata
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_shop_date (shop_id, collection_date),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (order_line_id) REFERENCES order_lines(id) ON DELETE CASCADE
);

-- 3. Create the Shop Transactions (Ledger) table if not exists
CREATE TABLE IF NOT EXISTS shop_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id INT NOT NULL,
    type ENUM('Bill', 'Payment', 'Adjustment', 'Opening Balance') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'Cash',
    description TEXT,
    balance_after DECIMAL(12, 2) NOT NULL,
    created_by VARCHAR(100) DEFAULT 'System',
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- 4. Ensure Shops table has necessary indices for the "Fallback" name matching
CREATE INDEX IF NOT EXISTS idx_shops_name_village ON shops(shop_name, village_name);
