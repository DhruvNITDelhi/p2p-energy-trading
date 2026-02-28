const fs = require('fs');
const path = require('path');
const config = require('../config');

const walletDir = config.WALLET_PATH;

if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
}

module.exports = {
    put: async (label, identity) => {
        const filePath = path.join(walletDir, `${label}.json`);
        fs.writeFileSync(filePath, JSON.stringify(identity));
    },

    get: async (label) => {
        const filePath = path.join(walletDir, `${label}.json`);
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath));
    },

    list: async () => {
        return fs.readdirSync(walletDir)
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
    },

    exists: async (label) => {
        const filePath = path.join(walletDir, `${label}.json`);
        return fs.existsSync(filePath);
    }
};
