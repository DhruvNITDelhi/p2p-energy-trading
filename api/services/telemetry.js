const blockchain = require('./blockchain');
const config = require('../config');

// Simple Threshold Logic
const VOLTAGE_THRESHOLD = 220; // Example
const CURRENT_THRESHOLD = 5;   // Example

async function ingest(panelId, payload) {
    // payload: { voltage, current, tokensGenerated, timestamp }
    console.log(`[Telemetry] Received from ${panelId}:`, payload);

    // Validate
    if (!payload.voltage || !payload.current) {
        throw new Error("Invalid Telemetry Data");
    }

    // Check Thresholds for Minting
    // Logic: If tokensGenerated is reported, mint it? Or calculate based on V*I*t?
    // User says: "if token generation thresholds are met, the API should automatically trigger ... to mint".
    // Let's assume the device reports `tokensGenerated` and we trust it or validate it.
    // Or we calculate power = V * I.
    // Let's use `tokensGenerated` from payload if present, else calculate.

    let amountToMint = 0;
    if (payload.tokensGenerated && payload.tokensGenerated > 0) {
        amountToMint = payload.tokensGenerated;
    } else {
        // Mock calc
        if (payload.voltage > VOLTAGE_THRESHOLD && payload.current > CURRENT_THRESHOLD) {
             amountToMint = 10; // 10 Tokens per tick if high power
        }
    }

    if (amountToMint > 0) {
        console.log(`[Telemetry] Minting ${amountToMint} tokens for ${panelId}`);
        try {
            // Use Admin identity to Mint
            // Note: panelId must be a registered node ID.
            const { contract, gateway, client } = await blockchain.getContract(config.ADMIN_USER);
            try {
                // Call MintTokens (alias to OracleMintAssets)
                await contract.submitTransaction('MintTokens', panelId, amountToMint.toString());
                console.log(`[Telemetry] Mint Success`);
                return { status: "Minted", amount: amountToMint };
            } finally {
                gateway.close();
                client.close();
            }
        } catch (e) {
            console.error(`[Telemetry] Mint Failed: ${e.message}`);
            throw e;
        }
    } else {
        return { status: "No Mint", amount: 0 };
    }
}

module.exports = { ingest };
