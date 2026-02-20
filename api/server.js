const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const wallet = require('./services/wallet');
const auth = require('./services/auth');
const blockchain = require('./services/blockchain');
const matcher = require('./services/matcher');
const telemetry = require('./services/telemetry'); // New
const becknRoutes = require('./routes/beckn'); // New
const initAdmin = require('./initAdmin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Beckn Protocol Stubs ---
app.use('/beckn', becknRoutes);

// --- Telemetry Endpoint (IoT) ---
app.post('/api/telemetry', async (req, res) => {
    try {
        const { panelId, payload } = req.body; // payload: { voltage, current, tokensGenerated }
        const result = await telemetry.ingest(panelId, payload);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.login(username, password);
        res.json(result);
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});

// 1. REGISTER NEW USER (Admin Only)
app.post('/api/auth/register', auth.verifyToken, auth.isAdmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing username or password" });

        await auth.register(username, password, role || 'user');
        res.json({ message: `User ${username} registered successfully` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. GET BALANCE
app.get('/api/node/me', auth.verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const { contract, gateway, client } = await blockchain.getContract(username);
        try {
            const resultBytes = await contract.evaluateTransaction('GetNode', username);
            res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 3. PLACE ORDER
app.post('/api/order', auth.verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const { id, orderType, price, quantity } = req.body;

        const { contract, gateway, client } = await blockchain.getContract(username);
        try {
            await contract.submitTransaction('PlaceOrder', id, username, orderType, price.toString(), quantity.toString());
        } finally { gateway.close(); client.close(); }

        await matcher.addOrder({
            id,
            owner: username,
            orderType,
            price: parseInt(price),
            quantity: parseInt(quantity),
            timestamp: Date.now()
        });

        res.json({ message: "Order Placed & Queued for Matching!" });
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 4. MINT ASSETS (Admin Only - Replaces Recharge)
app.post('/api/admin/mint', auth.verifyToken, auth.isAdmin, async (req, res) => {
    try {
        const { contract, gateway, client } = await blockchain.getContract(req.user.username);
        try {
            const { id, amount } = req.body;
            // Calls OracleMintAssets in Chaincode
            await contract.submitTransaction('OracleMintAssets', id, amount.toString());
            res.json({ message: "Assets Minted via Oracle Contract!" });
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 5. GET ALL USERS (Admin Only)
app.get('/api/admin/users', auth.verifyToken, auth.isAdmin, async (req, res) => {
    try {
        const { contract, gateway, client } = await blockchain.getContract(req.user.username);
        try {
            const resultBytes = await contract.evaluateTransaction('GetAllNodes');
            res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 6. ORDER BOOK
app.get('/api/orderbook', async (req, res) => {
    res.json(matcher.getOrderBook());
});

// 7. HISTORY
app.get('/api/history/:id', auth.verifyToken, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.username !== req.params.id) {
        return res.status(403).json({ error: "Access Denied" });
    }
    try {
        const { contract, gateway, client } = await blockchain.getContract(req.user.username);
        try {
            const resultBytes = await contract.evaluateTransaction('GetNodeHistory', req.params.id);
            res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 8. ESCROW TRADE CREATION (Enterprise P2P)
app.post('/api/trade/create', auth.verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const { tradeID, quantity, price } = req.body;
        // Note: Seller creates trade (locks energy).
        // tradeID should be unique.

        const { contract, gateway, client } = await blockchain.getContract(username);
        try {
             await contract.submitTransaction('CreateP2PTrade', tradeID, username, quantity.toString(), price.toString());
             res.json({ message: "P2P Trade Created & Energy Locked" });
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 9. ESCROW TRADE COMPLETION
app.post('/api/trade/complete', auth.verifyToken, async (req, res) => {
    try {
        const username = req.user.username; // Buyer
        const { tradeID } = req.body;

        const { contract, gateway, client } = await blockchain.getContract(username);
        try {
             await contract.submitTransaction('CompleteP2PTrade', tradeID, username);
             res.json({ message: "P2P Trade Completed & Tokens Transferred" });
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// Async Initialization before starting server
(async () => {
    try {
        await initAdmin(); // Ensure Admin exists
        app.listen(config.PORT, () => console.log(`⚡ EnergyConnect API Live on Port ${config.PORT}`));
    } catch (e) {
        console.error("Critical: Failed to initialize Admin. Server shutting down.", e);
        process.exit(1);
    }
})();
