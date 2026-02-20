const auth = require('./services/auth');
const wallet = require('./services/wallet');
const config = require('./config');
const fs = require('fs');
const path = require('path');

async function initAdmin() {
    console.log("--- Bootstrapping Admin ---");
    try {
        // 1. Register 'admin' in local users.json
        try {
            await auth.register(config.ADMIN_USER, config.ADMIN_PASSWORD, 'admin');
            console.log(`✅ Admin user '${config.ADMIN_USER}' registered in Web Auth.`);
        } catch (e) {
            console.log(`ℹ️  Admin user '${config.ADMIN_USER}' already in Web Auth.`);
        }

        // 2. Import Real Admin Credentials (or Mock if not found)
        const adminMspPath = path.resolve(config.CRYPTO_PATH, 'users', 'Admin@org1.example.com', 'msp');
        const signCertsPath = path.join(adminMspPath, 'signcerts');
        const keystorePath = path.join(adminMspPath, 'keystore');
        let cert, key;

        try {
            if (fs.existsSync(signCertsPath) && fs.existsSync(keystorePath)) {
                const certFiles = fs.readdirSync(signCertsPath);
                const keyFiles = fs.readdirSync(keystorePath);

                if (certFiles.length > 0 && keyFiles.length > 0) {
                     cert = fs.readFileSync(path.join(signCertsPath, certFiles[0]), 'utf8');
                     key = fs.readFileSync(path.join(keystorePath, keyFiles[0]), 'utf8');
                }
            }
        } catch (e) { console.error("Could not read real crypto", e); }

        if (!cert || !key) {
             console.log("⚠️  REAL CRYPTO NOT FOUND. USING MOCK (FOR DEMO).");
             cert = `-----BEGIN CERTIFICATE-----\nMOCK_ADMIN_CERT\n-----END CERTIFICATE-----`;
             key = `-----BEGIN PRIVATE KEY-----\nMOCK_ADMIN_KEY\n-----END PRIVATE KEY-----`;
        }

        const identity = {
            credentials: {
                certificate: cert,
                privateKey: key,
            },
            mspId: config.MSP_ID,
            type: 'X.509',
        };

        await wallet.put(config.ADMIN_USER, identity);
        console.log(`✅ Admin Identity imported into Wallet.`);

    } catch (e) {
        console.error("Bootstrap Failed:", e);
        throw e;
    }
}

module.exports = initAdmin;
