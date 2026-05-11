-- Daily Collections: Aggregated per-shop, per-date billing and payment summary
CREATE TABLE IF NOT EXISTS daily_collections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id INT NOT NULL,
    shop_name VARCHAR(255) NOT NULL,
    village_name VARCHAR(255) NOT NULL,
    order_line_id INT NOT NULL,
    collection_date DATE NOT NULL,

    -- Billing
    todays_bill_amount DECIMAL(12, 2) DEFAULT 0.00,

    -- Payment Collection (supports multi-mode)
    cash_collected DECIMAL(12, 2) DEFAULT 0.00,
    upi_collected DECIMAL(12, 2) DEFAULT 0.00,
    cheque_collected DECIMAL(12, 2) DEFAULT 0.00,

    -- Balances
    old_balance DECIMAL(12, 2) DEFAULT 0.00,
    total_balance DECIMAL(12, 2) DEFAULT 0.00,

    -- Metadata
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_shop_date (shop_id, collection_date),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (order_line_id) REFERENCES order_lines(id) ON DELETE CASCADE
);
