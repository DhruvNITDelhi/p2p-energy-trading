const blockchain = require('./blockchain');
const config = require('../config');

// In-Memory Order Book
let bids = []; // Buy Orders (Highest Price First)
let asks = []; // Sell Orders (Lowest Price First)

// Order Structure: { id, owner, price, quantity, timestamp }

const getOrderBook = () => {
    return [...bids, ...asks].map(o => ({...o, OrderType: bids.includes(o) ? 'BUY' : 'SELL'}));
};

const addOrder = async (order) => {
    // order: { id, owner, orderType, price, quantity }
    console.log(`Adding Order: ${JSON.stringify(order)}`);

    if (order.orderType === 'BUY') {
        bids.push(order);
        bids.sort((a, b) => b.price - a.price); // Descending
    } else {
        asks.push(order);
        asks.sort((a, b) => a.price - b.price); // Ascending
    }

    await matchOrders();
};

const matchOrders = async () => {
    // Simple matching loop
    while (bids.length > 0 && asks.length > 0) {
        const bestBid = bids[0];
        const bestAsk = asks[0];

        if (bestBid.price >= bestAsk.price) {
            // Match found!
            const tradeQty = Math.min(bestBid.quantity, bestAsk.quantity);
            const settlementPrice = bestAsk.price; // Usually match at earlier order price or mid, let's say Ask price

            console.log(`Match Found! Buyer: ${bestBid.owner}, Seller: ${bestAsk.owner}, Qty: ${tradeQty}, Price: ${settlementPrice}`);

            try {
                // Execute Settlement On-Chain
                // We use Admin identity to settle trades to ensure neutrality and authority
                const { contract, gateway, client } = await blockchain.getContract(config.ADMIN_USER);

                await contract.submitTransaction('SettleMatch',
                    bestBid.owner,
                    bestAsk.owner,
                    tradeQty.toString(),
                    settlementPrice.toString(),
                    bestBid.price.toString() // buyerOriginalPrice
                );

                console.log(`Settlement executed on-chain for ${tradeQty} units.`);

                gateway.close();
                client.close();

                // Update Local Book
                bestBid.quantity -= tradeQty;
                bestAsk.quantity -= tradeQty;

                if (bestBid.quantity === 0) bids.shift();
                if (bestAsk.quantity === 0) asks.shift();

            } catch (e) {
                console.error(`Settlement Failed: ${e.message}`);
                // If settlement fails, we must remove orders or retry?
                // For now, we remove them to prevent infinite loop of failure
                // Or break loop.
                break;
            }
        } else {
            break; // No overlap
        }
    }
};

module.exports = {
    addOrder,
    getOrderBook
};
