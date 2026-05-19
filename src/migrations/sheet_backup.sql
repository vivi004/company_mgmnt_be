-- Google Sheet Synchronization Backup and Protection Schema
-- Creates a secure storage table for historical product rates payload backups.
-- In case of network errors or corrupt Google Sheet formatting, this ensures zero downtime by serving the last known valid state.

CREATE TABLE IF NOT EXISTS sheet_backup (
    id INT AUTO_INCREMENT PRIMARY KEY,
    data LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_valid BOOLEAN DEFAULT TRUE
);
