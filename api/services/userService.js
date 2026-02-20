const FabricCAServices = require('fabric-ca-client');
const { User } = require('fabric-common');
const wallet = require('./wallet');
const config = require('../config');

async function registerUser(userId, secret) {
    console.log(`[userService] Attempting to register user: ${userId}`);
    try {
        // 1. Get Admin Identity from Wallet
        const adminIdentity = await wallet.get(config.ADMIN_USER);
        if (!adminIdentity) {
            console.error('[userService] Admin identity not found in wallet.');
            return { error: "Admin identity not found in wallet. Please run 'initAdmin.js' first." };
        }

        // 2. Setup CA Service
        const ca = new FabricCAServices(config.CA_URL);

        // 3. Construct Admin User Object (Registrar)
        // Using fabric-common User class to satisfy the registrar check
        const adminUser = new User(config.ADMIN_USER);

        // Configure CryptoSuite
        const cryptoSuite = FabricCAServices.newCryptoSuite();
        adminUser.setCryptoSuite(cryptoSuite);

        // Set Enrollment
        await adminUser.setEnrollment(
            adminIdentity.credentials.privateKey,
            adminIdentity.credentials.certificate,
            config.MSP_ID
        );

        // 4. Register
        let enrollmentSecret = secret;
        try {
            enrollmentSecret = await ca.register({
                enrollmentID: userId,
                enrollmentSecret: secret,
                role: 'client',
                affiliation: 'org1.department1',
                attrs: [{ name: "role", value: "client", ecert: true }]
            }, adminUser);
            console.log(`[userService] User ${userId} registered successfully with CA.`);
        } catch (regError) {
             if (regError.toString().includes('Identity already exists')) {
                 console.log(`[userService] User ${userId} already registered. Proceeding to enrollment.`);
             } else {
                 throw regError;
             }
        }

        // 5. Enroll
        console.log(`[userService] Enrolling user: ${userId}`);
        const enrollment = await ca.enroll({
            enrollmentID: userId,
            enrollmentSecret: secret
        });

        // 6. Save to wallet
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: config.MSP_ID,
            type: 'X.509',
        };

        await wallet.put(userId, x509Identity);
        console.log(`[userService] User ${userId} enrolled and saved to wallet.`);
        return { success: true };

    } catch (error) {
        console.error(`[userService] Failed to register/enroll user: ${error}`);
        return { error: error.message };
    }
}

module.exports = { registerUser };
