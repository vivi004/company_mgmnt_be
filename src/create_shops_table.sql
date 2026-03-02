-- Run this SQL to create the shops table
-- Execute in your MySQL client or phpMyAdmin

CREATE TABLE IF NOT EXISTS shops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_line_id INT NOT NULL,
    shop_name VARCHAR(150) NOT NULL,
    village_name VARCHAR(150) DEFAULT '',
    owner_name VARCHAR(100) DEFAULT '',
    phone VARCHAR(20) DEFAULT '',
    balance DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_line_id) REFERENCES order_lines(id) ON DELETE CASCADE
);

-- If table already exists, add village_name column:
-- ALTER TABLE shops ADD COLUMN village_name VARCHAR(150) DEFAULT '' AFTER shop_name;

-- Optional: seed example data (replace order_line_id values with real IDs from your DB)
-- INSERT INTO shops (order_line_id, shop_name, village_name, owner_name, phone, balance) VALUES
-- (1, 'Annai Store', 'Konganapuram', 'Ravi', '9876543210', 0.00),
-- (1, 'Balaji Traders', 'Konganapuram', 'Kumar', '9876543211', 1500.50),
-- (2, 'Sri Murugan Shop', 'Edappadi', 'Shankar', '9876543212', 250.00);
