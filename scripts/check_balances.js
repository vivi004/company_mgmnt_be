const mysql = require('mysql2/promise');
require('dotenv').config();

async function testQueryForDate(connection, date, shopId) {
    const olId = 14; // Edappadi-Local (from summary)
    const [rows] = await connection.query(`
        SELECT 
            s.id AS shop_id,
            s.shop_name,
            ? AS collection_date,
            
            -- The PREV BAL logic
            COALESCE(
                dc.old_balance, 
                COALESCE(
                    prev.total_balance, 
                    COALESCE(
                        (
                            SELECT tx.balance_after 
                            FROM shop_transactions tx 
                            WHERE tx.shop_id = s.id 
                              AND tx.transaction_date < ? 
                              AND tx.approval_status = 'APPROVED'
                            ORDER BY tx.transaction_date DESC, tx.id DESC 
                            LIMIT 1
                        ),
                        IF(DATE(s.created_at) <= ?, COALESCE(sb.opening_balance, 0), 0)
                    )
                )
            ) AS old_balance,

            -- The TOTAL BAL logic
            COALESCE(
                dc.total_balance,
                COALESCE(
                    prev.total_balance, 
                    COALESCE(
                        (
                            SELECT tx.balance_after 
                            FROM shop_transactions tx 
                            WHERE tx.shop_id = s.id 
                              AND tx.transaction_date < ? 
                              AND tx.approval_status = 'APPROVED'
                            ORDER BY tx.transaction_date DESC, tx.id DESC 
                            LIMIT 1
                        ),
                        IF(DATE(s.created_at) <= ?, COALESCE(sb.opening_balance, 0), 0)
                    )
                ) + COALESCE(dc.todays_bill_amount, 0) - (COALESCE(dc.cash_collected, 0) + COALESCE(dc.upi_collected, 0) + COALESCE(dc.cheque_collected, 0)) + COALESCE(dc.manual_adjustments, 0) - COALESCE(dc.return_amount, 0)
            ) AS total_balance
        FROM shops s
        JOIN order_lines ol ON s.order_line_id = ol.id
        LEFT JOIN shop_balances sb ON s.id = sb.shop_id
        LEFT JOIN daily_collections dc ON s.id = dc.shop_id AND dc.collection_date = ?
        LEFT JOIN (
            SELECT dc1.shop_id, dc1.total_balance
            FROM daily_collections dc1
            INNER JOIN (
                SELECT shop_id, MAX(collection_date) as max_date
                FROM daily_collections
                WHERE collection_date < ?
                GROUP BY shop_id
            ) dc2 ON dc1.shop_id = dc2.shop_id AND dc1.collection_date = dc2.max_date
        ) prev ON s.id = prev.shop_id
        WHERE s.id = ?
    `, [date, date, date, date, date, date, date, shopId]);
    return rows[0];
}

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        console.log("Connected to database successfully!");
        const shopId = 186; // A.R.S.STORE
        const dates = ['2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22'];

        console.log(`Checking ledger balances for shop ID ${shopId} across dates...`);
        for (const date of dates) {
            const res = await testQueryForDate(connection, date, shopId);
            console.log(`Date: ${date} -> shop_name: ${res.shop_name}, old_balance: ${res.old_balance}, total_balance: ${res.total_balance}`);
        }

        console.log("\nChecking raw shop_transactions to see history of shop ID 186:");
        const [txs] = await connection.query(`
            SELECT id, type, amount, balance_after, approval_status, transaction_date
            FROM shop_transactions
            WHERE shop_id = ?
            ORDER BY transaction_date ASC, id ASC
        `, [shopId]);
        console.log(txs);

        console.log("\nChecking daily_collections rows for shop ID 186:");
        const [dcs] = await connection.query(`
            SELECT collection_date, old_balance, todays_bill_amount, cash_collected, total_balance
            FROM daily_collections
            WHERE shop_id = ?
            ORDER BY collection_date ASC
        `, [shopId]);
        console.log(dcs);

    } catch (err) {
        console.error("Error running test:", err);
    } finally {
        await connection.end();
    }
}

main();
