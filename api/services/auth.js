const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const wallet = require('./wallet');

const USERS_FILE = path.join(__dirname, '..', 'users.json');

// Helper to read/write users
const getUsers = () => {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE));
};

const saveUser = (username, passwordHash) => {
    const users = getUsers();
    users[username] = { passwordHash };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

const verifyPassword = async (username, password) => {
    const users = getUsers();
    if (!users[username]) return false;
    return await bcrypt.compare(password, users[username].passwordHash);
};

const register = async (username, password) => {
    const users = getUsers();
    if (users[username]) throw new Error('User already exists');

    // 1. Create Blockchain Identity (Mocking the CA interaction for now if CA is down,
    // or calling real userService if we had one working perfectly).
    // For this demo, we will simulate the creation of a wallet entry.

    // In a real app, call: await require('./userService').registerUser(username, password);
    // Here, we'll just ensure a wallet entry "exists" or is created.

    const mockIdentity = {
        credentials: {
            certificate: `-----BEGIN CERTIFICATE-----\n(Mock Cert for ${username})\n-----END CERTIFICATE-----`,
            privateKey: `-----BEGIN PRIVATE KEY-----\n(Mock Key for ${username})\n-----END PRIVATE KEY-----`
        },
        mspId: config.MSP_ID,
        type: 'X.509'
    };
    await wallet.put(username, mockIdentity);

    // 2. Save Web Credentials
    const hash = await bcrypt.hash(password, 10);
    saveUser(username, hash);

    return { username };
};

const login = async (username, password) => {
    const isValid = await verifyPassword(username, password);
    if (!isValid) throw new Error('Invalid credentials');

    // Issue JWT
    const token = jwt.sign({ username, mspId: config.MSP_ID }, config.JWT_SECRET, { expiresIn: '1h' });
    return { token, username };
};

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Failed to authenticate token' });
        req.user = decoded;
        next();
    });
};

module.exports = {
    register,
    login,
    verifyToken
};
