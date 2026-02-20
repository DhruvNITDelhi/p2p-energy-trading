const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const wallet = require('./services/wallet');
const auth = require('./services/auth');
const blockchain = require('./services/blockchain'); // Use extracted module
const matcher = require('./services/matcher');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing username or password" });
        await auth.register(username, password);
        res.json({ message: `User ${username} registered successfully` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.login(username, password);
        res.json(result);
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});

// --- Protected Routes ---

// 1. GET BALANCE (Personalized)
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

// 2. PLACE ORDER
app.post('/api/order', auth.verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const { id, orderType, price, quantity } = req.body;

        // 1. Lock funds on chain (creates 'Order' asset / intent)
        const { contract, gateway, client } = await blockchain.getContract(username);
        try {
            await contract.submitTransaction('PlaceOrder', id, username, orderType, price.toString(), quantity.toString());
        } finally { gateway.close(); client.close(); }

        // 2. Add to Off-Chain Matcher
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

// 3. RECHARGE (Admin Only)
app.post('/api/recharge', auth.verifyToken, async (req, res) => {
    if (req.user.username !== config.ADMIN_USER) return res.status(403).json({ error: "Admin only" });
    try {
        const { contract, gateway, client } = await blockchain.getContract(req.user.username);
        try {
            const { id, amount } = req.body;
            await contract.submitTransaction('RechargeNode', id, amount.toString());
            res.json({ message: "Recharge Success!" });
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

// 4. ORDER BOOK (Off-Chain Source)
app.get('/api/orderbook', async (req, res) => {
    // Return the matcher's current book
    res.json(matcher.getOrderBook());
});

// 5. HISTORY
app.get('/api/history/:id', auth.verifyToken, async (req, res) => {
    try {
        const { contract, gateway, client } = await blockchain.getContract(req.user.username);
        try {
            const resultBytes = await contract.evaluateTransaction('GetNodeHistory', req.params.id);
            res.json(JSON.parse(new TextDecoder().decode(resultBytes)));
        } finally { gateway.close(); client.close(); }
    } catch (e) { res.status(500).send({error: e.message}); }
});

app.listen(config.PORT, () => console.log(`⚡ EnergyConnect API Live on Port ${config.PORT}`));
