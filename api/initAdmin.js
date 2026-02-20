const auth = require('./services/auth');
const wallet = require('./services/wallet');
const config = require('./config');

async function initAdmin() {
    console.log("--- Bootstrapping Admin ---");
    try {
        // 1. Register 'admin' in local users.json (if not exists)
        try {
            await auth.register(config.ADMIN_USER, config.ADMIN_PASSWORD, 'admin');
            console.log(`✅ Admin user '${config.ADMIN_USER}' registered in Web Auth.`);
        } catch (e) {
            console.log(`ℹ️  Admin user '${config.ADMIN_USER}' already in Web Auth.`);
        }

        // 2. Ensure Admin Identity in Wallet has 'admin' attribute
        // In a real scenario, we'd enroll with CA request for attributes.
        // Here, we verify the wallet has the admin cert.
        // The mock 'register' above in auth.js (from previous step) puts a cert in wallet.
        // We need to ensure that cert is treated as "admin" by our logic.

        // Since we are mocking the CA interaction in 'auth.js' for this environment,
        // we will manually update the wallet entry to include the attribute metadata if possible,
        // or rely on the MSPID check in chaincode (fallback).

        const exists = await wallet.exists(config.ADMIN_USER);
        if (exists) {
            console.log(`✅ Admin Identity found in Wallet.`);
        } else {
            console.error(`❌ Admin Identity MISSING in Wallet. Run full setup.`);
        }

    } catch (e) {
        console.error("Bootstrap Failed:", e);
    }
}

initAdmin();
