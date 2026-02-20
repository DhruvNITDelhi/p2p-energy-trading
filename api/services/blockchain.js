const { connect, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const config = require('../config');
const wallet = require('./wallet');

async function getContract(username) {
    // 1. Load Identity from Wallet
    let identityJson;

    if (username) {
        identityJson = await wallet.get(username);
        if (!identityJson) throw new Error(`User ${username} not found in wallet`);
    } else {
        // Fallback to Admin
        identityJson = await wallet.get(config.ADMIN_USER);
        if (!identityJson) {
             throw new Error("No identity provided and Admin not found in wallet");
        }
    }

    const tlsCertPath = path.join(config.CRYPTO_PATH, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    const tlsRootCert = fs.readFileSync(tlsCertPath);

    const client = new grpc.Client('localhost:7051', grpc.credentials.createSsl(tlsRootCert), { 'grpc.ssl_target_name_override': 'peer0.org1.example.com' });

    const gateway = connect({
        client,
        identity: { mspId: config.MSP_ID, credentials: Buffer.from(identityJson.credentials.certificate) },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(identityJson.credentials.privateKey))
    });

    return { contract: gateway.getNetwork(config.CHANNEL_NAME).getContract(config.CHAINCODE_NAME), gateway, client };
}

module.exports = { getContract };
