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

    // Handle Certificate Path (May be absolute if Docker)
    let tlsCertPath;
    if (path.isAbsolute(config.CRYPTO_PATH)) {
        tlsCertPath = path.join(config.CRYPTO_PATH, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    } else {
        tlsCertPath = path.resolve(config.CRYPTO_PATH, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    }

    const tlsRootCert = fs.readFileSync(tlsCertPath);

    // Connect to Peer
    const client = new grpc.Client(config.PEER_ENDPOINT, grpc.credentials.createSsl(tlsRootCert), { 'grpc.ssl_target_name_override': config.PEER_HOST_OVERRIDE });

    const gateway = connect({
        client,
        identity: { mspId: config.MSP_ID, credentials: Buffer.from(identityJson.credentials.certificate) },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(identityJson.credentials.privateKey))
    });

    return { contract: gateway.getNetwork(config.CHANNEL_NAME).getContract(config.CHAINCODE_NAME), gateway, client };
}

module.exports = { getContract };
