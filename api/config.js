require('dotenv').config();
const path = require('path');

module.exports = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET: process.env.JWT_SECRET || 'energy-stack-secret-key-2024',

    // Blockchain Network Config
    CHANNEL_NAME: process.env.CHANNEL_NAME || 'mychannel',
    CHAINCODE_NAME: process.env.CHAINCODE_NAME || 'energy',
    MSP_ID: process.env.MSP_ID || 'Org1MSP',

    // Paths (Using environment variables or defaults relative to this file)
    CRYPTO_PATH: process.env.CRYPTO_PATH || path.resolve(__dirname, '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com'),
    WALLET_PATH: process.env.WALLET_PATH || path.resolve(__dirname, 'wallet'),

    // CA Config
    CA_HOSTNAME: process.env.CA_HOSTNAME || 'ca.org1.example.com',
    CA_URL: process.env.CA_URL || 'https://localhost:7054',
    ADMIN_USER: process.env.ADMIN_USER || 'admin',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'adminpw',
};
