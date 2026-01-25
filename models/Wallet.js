const db = require('../db/database');

class Wallet {
    static async getBalance(userId) {
        const result = await db.query(
            `SELECT deposit_balance, win_balance FROM wallets WHERE user_id = $1`,
            [userId]
        );
        const row = result.rows[0];
        if (!row) return { total: 0, deposit: 0, win: 0 };
        
        const deposit = parseFloat(row.deposit_balance || 0);
        const win = parseFloat(row.win_balance || 0);
        
        return {
            total: deposit + win,
            deposit: deposit,
            win: win
        };
    }

    static async deposit(userId, amount, description = 'Deposit') {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const balanceResult = await client.query(
                `SELECT deposit_balance, win_balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
                [userId]
            );
            
            const depositBefore = parseFloat(balanceResult.rows[0]?.deposit_balance || 0);
            const winBefore = parseFloat(balanceResult.rows[0]?.win_balance || 0);
            const totalBefore = depositBefore + winBefore;
            
            const depositAfter = depositBefore + parseFloat(amount);
            const totalAfter = depositAfter + winBefore;
            
            await client.query(
                `UPDATE wallets SET deposit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
                [depositAfter, userId]
            );
            
            await client.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
                 VALUES ($1, 'deposit', $2, $3, $4, $5)`,
                [userId, amount, totalBefore, totalAfter, description]
            );
            
            await client.query('COMMIT');
            
            return { success: true, balance: totalAfter, deposit: depositAfter, win: winBefore };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async withdraw(userId, amount, description = 'Withdrawal') {
    const client = await db.pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // የሂሳብ መጠን መረጃን ማምጣት
        const balanceResult = await client.query(
            `SELECT deposit_balance, win_balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
            [userId]
        );
        
        const depositBefore = parseFloat(balanceResult.rows[0]?.deposit_balance || 0);
        const winBefore = parseFloat(balanceResult.rows[0]?.win_balance || 0);
        const totalBefore = depositBefore + winBefore;
        
        // 1. ዝቅተኛ የሂሳብ መጠን ቼክ (100 ብር)
        if (totalBefore < 100) {
            await client.query('ROLLBACK');
            return { success: false, error: 'ገንዘብ ለማውጣት ቢያንስ 100 ብር በሂሳብዎ ላይ ሊኖርዎት ይገባል!' };
        }

        // 2. ማውጣት የሚቻለው ከማሸነፊያ (Win Balance) ላይ ብቻ መሆኑን ማረጋገጥ
        if (winBefore < amount) {
            await client.query('ROLLBACK');
            return { success: false, error: 'ሊወጣ የሚችል በቂ የማሸነፊያ (Win Balance) የለዎትም!' };
        }

        // 3. ቢያንስ 100 ብር ዲፖዚት ማድረጋቸውን ማረጋገጥ
        const depositCheck = await client.query(
            `SELECT COUNT(*) FROM transactions WHERE user_id = $1 AND type = 'deposit' AND amount >= 100`,
            [userId]
        );
        if (parseInt(depositCheck.rows[0].count) < 1) {
            await client.query('ROLLBACK');
            return { success: false, error: 'ገንዘብ ለማውጣት ቢያንስ አንድ ጊዜ 100 ብር እና ከዚያ በላይ ዲፖዚት ማድረግ ይኖርብዎታል!' };
        }

        // 4. ቢያንስ 2 ጊዜ ማሸነፋቸውን ማረጋገጥ
        const winCheck = await client.query(
            `SELECT COUNT(*) FROM game_participants WHERE user_id = $1 AND is_winner = true`,
            [userId]
        );
        if (parseInt(winCheck.rows[0].count) < 2) {
            await client.query('ROLLBACK');
            return { success: false, error: 'ገንዘብ ለማውጣት ቢያንስ 2 ጊዜ ማሸነፍ ይኖርብዎታል!' };
        }
        
        // ዊዝድሮው ማካሄድ
        const winAfter = winBefore - parseFloat(amount);
        await client.query(
            `UPDATE wallets SET win_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
            [winAfter, userId]
        );
        
        // ትራንዛክሽን መመዝገብ
        await client.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
             VALUES ($1, 'withdrawal', $2, $3, $4, $5)`,
            [userId, amount, totalBefore, depositBefore + winAfter, description]
        );
        
        await client.query('COMMIT');
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
    static async stake(userId, amount, gameId) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const balanceResult = await client.query(
                `SELECT deposit_balance, win_balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
                [userId]
            );
            
            let depositBefore = parseFloat(balanceResult.rows[0]?.deposit_balance || 0);
            let winBefore = parseFloat(balanceResult.rows[0]?.win_balance || 0);
            const totalBefore = depositBefore + winBefore;
            
            if (totalBefore < amount) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Insufficient balance' };
            }
            
            // Deduct from deposit_balance first, then win_balance
            let amountToDeduct = parseFloat(amount);
            let depositAfter = depositBefore;
            let winAfter = winBefore;

            if (depositBefore >= amountToDeduct) {
                depositAfter = depositBefore - amountToDeduct;
                amountToDeduct = 0;
            } else {
                amountToDeduct -= depositBefore;
                depositAfter = 0;
                winAfter = winBefore - amountToDeduct;
            }

            const totalAfter = depositAfter + winAfter;
            
            await client.query(
                `UPDATE wallets SET deposit_balance = $1, win_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3`,
                [depositAfter, winAfter, userId]
            );
            
            await client.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, game_id)
                 VALUES ($1, 'stake', $2, $3, $4, $5, $6)`,
                [userId, amount, totalBefore, totalAfter, `Stake for game #${gameId}`, gameId]
            );
            
            await client.query('COMMIT');
            
            return { success: true, balance: totalAfter, deposit: depositAfter, win: winAfter };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async win(userId, amount, gameId) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const balanceResult = await client.query(
                `SELECT deposit_balance, win_balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
                [userId]
            );
            
            const depositBefore = parseFloat(balanceResult.rows[0]?.deposit_balance || 0);
            const winBefore = parseFloat(balanceResult.rows[0]?.win_balance || 0);
            const totalBefore = depositBefore + winBefore;
            
            const winAfter = winBefore + parseFloat(amount);
            const totalAfter = depositBefore + winAfter;
            
            await client.query(
                `UPDATE wallets SET win_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
                [winAfter, userId]
            );
            
            await client.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, game_id)
                 VALUES ($1, 'win', $2, $3, $4, $5, $6)`,
                [userId, amount, totalBefore, totalAfter, `Won game #${gameId}`, gameId]
            );
            
            await client.query('COMMIT');
            
            return { success: true, balance: totalAfter, deposit: depositBefore, win: winAfter };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async getTransactionHistory(userId, limit = 50) {
        const result = await db.query(
            `SELECT * FROM transactions 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    }
}

module.exports = Wallet;
