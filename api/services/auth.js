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

const saveUser = (username, passwordHash, role = 'user') => {
    const users = getUsers();
    users[username] = { passwordHash, role };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

const verifyPassword = async (username, password) => {
    const users = getUsers();
    if (!users[username]) return false;
    return await bcrypt.compare(password, users[username].passwordHash);
};

const register = async (username, password, role = 'user') => {
    const users = getUsers();
    if (users[username]) throw new Error('User already exists');

    // 1. Create Blockchain Identity (Mocking the CA interaction)
    // We add the 'role' attribute to the wallet metadata if we were doing real checks on Node side,
    // but Node side checks JWT. Chaincode checks cert.
    // Simulating cert attribute injection:
    const mockCert = `-----BEGIN CERTIFICATE-----\n(Mock Cert for ${username} with role=${role})\n-----END CERTIFICATE-----`;

    const mockIdentity = {
        credentials: {
            certificate: mockCert,
            privateKey: `-----BEGIN PRIVATE KEY-----\n(Mock Key for ${username})\n-----END PRIVATE KEY-----`
        },
        mspId: config.MSP_ID,
        type: 'X.509'
    };
    await wallet.put(username, mockIdentity);

    // 2. Save Web Credentials
    const hash = await bcrypt.hash(password, 10);
    saveUser(username, hash, role);

    return { username, role };
};

const login = async (username, password) => {
    const isValid = await verifyPassword(username, password);
    if (!isValid) throw new Error('Invalid credentials');

    const users = getUsers();
    const role = users[username].role || 'user';

    // Issue JWT with Role
    const token = jwt.sign({ username, role, mspId: config.MSP_ID }, config.JWT_SECRET, { expiresIn: '1h' });
    return { token, username, role };
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

const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access Denied: Admin Role Required' });
    }
    next();
};

module.exports = {
    register,
    login,
    verifyToken,
    isAdmin
};
