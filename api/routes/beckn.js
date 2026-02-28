const express = require('express');
const router = express.Router();
const blockchain = require('../services/blockchain');
const config = require('../config');

// Helper to query chaincode
async function getOrderBook() {
    const { contract, gateway, client } = await blockchain.getContract(config.ADMIN_USER); // Read as Admin
    try {
        const resultBytes = await contract.evaluateTransaction('GetOrderBook');
        const data = new TextDecoder().decode(resultBytes);
        return data ? JSON.parse(data) : [];
    } finally { gateway.close(); client.close(); }
}

// /on_search: Return Catalog (Sell Orders)
router.post('/on_search', async (req, res) => {
    try {
        const context = req.body.context;
        const orders = await getOrderBook();

        // Filter SELL orders (Providers offering energy)
        const offers = orders.filter(o => o.OrderType === 'SELL');

        const catalog = {
            "bpp/descriptor": { "name": "EnergyConnect P2P" },
            "bpp/providers": offers.map(o => ({
                "id": o.Owner,
                "descriptor": { "name": `Energy Provider ${o.Owner}` },
                "items": [{
                    "id": o.ID,
                    "descriptor": { "name": "Solar Energy Unit" },
                    "price": { "currency": "INR", "value": o.Price },
                    "quantity": { "available": { "count": o.Quantity } }
                }]
            }))
        };

        res.json({ context, message: { catalog } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// /on_select: Confirm Selection
router.post('/on_select', async (req, res) => {
    // Check if item still available
    // Mock Response for now
    res.json({ context: req.body.context, message: { order: { state: "Draft", items: req.body.message.order.items } } });
});

// /on_init: Init Order
router.post('/on_init', async (req, res) => {
    // Generate Payment Link / Quote
    res.json({ context: req.body.context, message: { order: { state: "Initialized", quote: { price: { currency: "INR", value: "100" } } } } });
});

// /on_confirm: Create Trade
router.post('/on_confirm', async (req, res) => {
    // Trigger Chaincode CreateP2PTrade?
    // Extract details
    // For simplicity, just return Confirmed status
    res.json({ context: req.body.context, message: { order: { state: "Confirmed", id: "ord_123" } } });
});

module.exports = router;
