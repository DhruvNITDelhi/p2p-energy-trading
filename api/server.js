const express = require('express');
const cors = require('cors');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves your UI

const AUTH_TOKEN = "EnergyAdmin2026"; 

// --- Blockchain Config (Auto-Discover Keys) ---
const cryptoPath = path.resolve(__dirname, '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');

// 1. AUTO-DISCOVER CERTIFICATE
const certDir = path.resolve(cryptoPath, 'users', 'Admin@org1.example.com', 'msp', 'signcerts');
const certFile = fs.readdirSync(certDir)[0]; // Grabs whatever file is inside automatically
const certPath = path.resolve(certDir, certFile);

// 2. AUTO-DISCOVER PRIVATE KEY
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'Admin@org1.example.com', 'msp', 'keystore');
const keyFile = fs.readdirSync(keyDirectoryPath)[0];
const keyPath = path.resolve(keyDirectoryPath, keyFile);

// --- Helper to Connect to Blockchain ---
async function getContract() {
    const tlsRootCert = fs.readFileSync(tlsCertPath);
    const client = new grpc.Client('localhost:7051', grpc.credentials.createSsl(tlsRootCert), { 'grpc.ssl_target_name_override': 'peer0.org1.example.com' });
    
    const gateway = connect({ 
        client, 
        identity: { mspId: 'Org1MSP', credentials: fs.readFileSync(certPath) }, 
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(fs.readFileSync(keyPath))) 
    });
    
    return { contract: gateway.getNetwork('mychannel').getContract('energy'), gateway, client };
}

// --- API ROUTES ---

// 1. GET BALANCE ROUTE
app.get('/api/node/:id', async (req, res) => {
    const { contract, gateway, client } = await getContract();
    try {
        const resultBytes = await contract.evaluateTransaction('GetNode', req.params.id);
        res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (e) { res.status(500).send({error: e.message}); }
    finally { gateway.close(); client.close(); }
});

// 2. GET ORDER BOOK ROUTE
app.get('/api/orderbook', async (req, res) => {
    const { contract, gateway, client } = await getContract();
    try {
        const resultBytes = await contract.evaluateTransaction('GetOrderBook');
        const data = new TextDecoder().decode(resultBytes);
        res.json(data ? JSON.parse(data) : []);
    } catch (e) { res.status(500).send({error: e.message}); }
    finally { gateway.close(); client.close(); }
});

// 3. PLACE LIMIT ORDER ROUTE
app.post('/api/order', async (req, res) => {
    if (req.headers['authorization'] !== AUTH_TOKEN) return res.status(401).json({error: "Unauthorized"});
    const { contract, gateway, client } = await getContract();
    try {
        const { id, owner, orderType, price, quantity } = req.body;
        await contract.submitTransaction('PlaceOrder', id, owner, orderType, price.toString(), quantity.toString());
        res.json({ message: "Order Placed & Matching Engine Triggered!" });
    } catch (e) { res.status(500).send({error: e.message}); }
    finally { gateway.close(); client.close(); }
});

// 4. SECURE RECHARGE ROUTE
app.post('/api/recharge', async (req, res) => {
    if (req.headers['authorization'] !== AUTH_TOKEN) return res.status(401).json({error: "Unauthorized"});
    const { contract, gateway, client } = await getContract();
    try {
        const { id, amount } = req.body;
        await contract.submitTransaction('RechargeNode', id, amount.toString());
        res.json({ message: "Recharge Success!" });
    } catch (e) { res.status(500).send({error: e.message}); }
    finally { gateway.close(); client.close(); }
});

// 5. GET TRANSACTION HISTORY
app.get('/api/history/:id', async (req, res) => {
    const { contract, gateway, client } = await getContract();
    try {
        const resultBytes = await contract.evaluateTransaction('GetNodeHistory', req.params.id);
        res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
    } catch (e) { res.status(500).send({error: e.message}); }
    finally { gateway.close(); client.close(); }
});

// Start Server
app.listen(3000, () => console.log("⚡ EnergyConnect API Live on Port 3000"));