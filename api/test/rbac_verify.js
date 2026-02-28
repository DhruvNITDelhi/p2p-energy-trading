const axios = require('axios');

const API = "http://localhost:3000/api";
let adminToken = '';
let userToken = '';

async function testFlow() {
    console.log("--- Starting RBAC Verification ---");

    // 1. Login Admin
    try {
        const res = await axios.post(`${API}/auth/login`, { username: 'admin', password: 'adminpw' });
        adminToken = res.data.token;
        console.log("✅ Admin Login Success");
    } catch (e) {
        console.error("❌ Admin Login Failed", e.response ? e.response.data : e.message);
        process.exit(1);
    }

    // 2. Admin Registers User
    try {
        const res = await axios.post(`${API}/auth/register`,
            { username: 'newNode', password: 'pw', role: 'user' },
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        console.log("✅ Admin Registration of User Success");
    } catch (e) {
        console.error("❌ Admin Registration Failed", e.response ? e.response.data : e.message);
    }

    // 3. Login User
    try {
        const res = await axios.post(`${API}/auth/login`, { username: 'newNode', password: 'pw' });
        userToken = res.data.token;
        console.log("✅ User Login Success");
    } catch (e) {
        console.error("❌ User Login Failed");
        process.exit(1);
    }

    // 4. User tries to Register (Should Fail)
    try {
        await axios.post(`${API}/auth/register`,
            { username: 'hacker', password: 'pw' },
            { headers: { Authorization: `Bearer ${userToken}` } }
        );
        console.error("❌ RBAC FAIL: User was able to register!");
    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.log("✅ RBAC Success: User denied registration access.");
        } else {
            console.error("❌ Unexpected Error on User Register", e.message);
        }
    }

    // 5. User tries to Mint (Should Fail)
    try {
        await axios.post(`${API}/admin/mint`,
            { id: 'newNode', amount: 100 },
            { headers: { Authorization: `Bearer ${userToken}` } }
        );
        console.error("❌ RBAC FAIL: User was able to mint!");
    } catch (e) {
        if (e.response && e.response.status === 403) {
            console.log("✅ RBAC Success: User denied mint access.");
        } else {
            console.error("❌ Unexpected Error on User Mint", e.message);
        }
    }

    console.log("--- Verification Complete ---");
}

testFlow();
