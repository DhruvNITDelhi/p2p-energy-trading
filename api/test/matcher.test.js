const matcher = require('../services/matcher');
const blockchain = require('../services/blockchain');

// Mock Blockchain
blockchain.getContract = async (user) => {
    return {
        contract: {
            submitTransaction: async (fn, ...args) => {
                console.log(`[MockBlockchain] Triggered ${fn} with args:`, args);
                return Buffer.from('success');
            }
        },
        gateway: { close: () => {} },
        client: { close: () => {} }
    };
};

async function testMatcher() {
    console.log("--- Testing Matcher ---");

    // Add Sell Order: 10 units @ 50
    await matcher.addOrder({ id: 's1', owner: 'Alice', orderType: 'SELL', price: 50, quantity: 10 });

    // Add Buy Order: 5 units @ 50
    await matcher.addOrder({ id: 'b1', owner: 'Bob', orderType: 'BUY', price: 50, quantity: 5 });

    // Expect: Match of 5 units. s1 has 5 left. b1 removed.

    const book = matcher.getOrderBook();
    console.log("Book:", JSON.stringify(book, null, 2));

    if (book.length === 1 && book[0].id === 's1' && book[0].quantity === 5) {
        console.log("✅ Matcher Logic Passed");
    } else {
        console.error("❌ Matcher Logic Failed");
        process.exit(1);
    }
}

testMatcher();
