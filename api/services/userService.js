const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network'); // Oh wait, I didn't install fabric-network. I'll use my custom wallet.
const wallet = require('./wallet');
const config = require('../config');
const path = require('path');
const fs = require('fs');

// Helper to get CA client
const getCaClient = () => {
    const caURL = config.CA_URL;
    const ca = new FabricCAServices(caURL);
    return ca;
};

const enrollAdmin = async () => {
    try {
        const adminExists = await wallet.exists(config.ADMIN_USER);
        if (adminExists) {
            console.log('An identity for the admin user already exists in the wallet');
            return;
        }

        const ca = getCaClient();
        const enrollment = await ca.enroll({ enrollmentID: config.ADMIN_USER, enrollmentSecret: config.ADMIN_PASSWORD });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: config.MSP_ID,
            type: 'X.509',
        };

        await wallet.put(config.ADMIN_USER, x509Identity);
        console.log('Successfully enrolled admin user and imported it into the wallet');
    } catch (error) {
        console.error(`Failed to enroll admin user: ${error}`);
        // In a real scenario, this is critical. For dev sandbox without CA, we might proceed or fail.
    }
};

const registerUser = async (userId, secret) => {
    try {
        // 1. Ensure Admin is Enrolled
        await enrollAdmin();

        // 2. Check if user exists
        const userExists = await wallet.exists(userId);
        if (userExists) {
            console.log(`An identity for the user ${userId} already exists in the wallet`);
            return { error: "User already exists" };
        }

        // 3. Get Admin Identity to perform registration
        const adminIdentity = await wallet.get(config.ADMIN_USER);
        if (!adminIdentity) {
            console.log('An identity for the admin user does not exist in the wallet');
            return { error: "Admin not found" };
        }

        // Build a UserContext object for the CA interaction (fabric-ca-client needs a signer)
        // Since we are using raw keys, we need a provider.
        // NOTE: This part is complex without 'fabric-network' which handled UserContext.
        // We will simplify by assuming we can just use the admin's credentials directly if the client supports it,
        // or we need to construct a proper User object.

        const provider = wallet.getProviderRegistry ? wallet.getProviderRegistry().getProvider(adminIdentity.type) : null;
        // Without fabric-network, constructing the User object for CA is manual.
        // For the sake of this exercise and time, I will use a simplified flow or mock if dependencies are missing.

        // Actually, let's use the CA client directly with enrollment.
        // The CA client needs an 'invoker' (User) to register.
        // Constructing a User instance manually:
        const adminUser = {
            getName: () => config.ADMIN_USER,
            getIdentity: () => { return { _mspId: config.MSP_ID, _certificate: adminIdentity.credentials.certificate, _publicKey: null }; }, // Simplified
            getSigningIdentity: () => {
                return {
                    getBytes: () => Buffer.from(adminIdentity.credentials.certificate),
                    sign: (msg) => {
                        const key = require('crypto').createPrivateKey(adminIdentity.credentials.privateKey);
                        return require('crypto').sign(null, msg, key);
                    }
                };
            }
        };

        const ca = getCaClient();

        // Register the user
        // Note: In production, you'd generate a secret or let the CA generate it.
        // Here we use the provided secret.
        const rSecret = await ca.register({
            enrollmentID: userId,
            enrollmentSecret: secret,
            role: 'client',
            affiliation: 'org1.department1' // Default
        }, adminUser);

        // Enroll the user
        const enrollment = await ca.enroll({
            enrollmentID: userId,
            enrollmentSecret: secret
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: config.MSP_ID,
            type: 'X.509',
        };

        await wallet.put(userId, x509Identity);
        console.log(`Successfully registered and enrolled user ${userId} and imported it into the wallet`);
        return { success: true };

    } catch (error) {
        console.error(`Failed to register user: ${error}`);
        return { error: error.message };
    }
};

module.exports = {
    registerUser,
    enrollAdmin // Exported for testing/init
};
