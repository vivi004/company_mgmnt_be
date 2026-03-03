CREATE TABLE IF NOT EXISTS bills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_no VARCHAR(50) NOT NULL,
    shop_name VARCHAR(255) NOT NULL,
    village_name VARCHAR(255) NOT NULL,
    cart JSON NOT NULL,
    custom_rates JSON DEFAULT NULL,
    created_by VARCHAR(100) NOT NULL,
    bill_date DATETIME NOT NULL,
    status ENUM('Unverified', 'Verified') DEFAULT 'Unverified',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
