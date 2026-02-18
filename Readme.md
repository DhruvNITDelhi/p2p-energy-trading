# ⚡ Decentralized P2P Energy Marketplace

A full-stack, enterprise-grade blockchain application built to facilitate peer-to-peer energy trading between prosumers and consumers using Hyperledger Fabric.

## 🏗️ Architecture
* **Smart Contract (Brain):** Written in Go. Handles ledger initialization, state queries, real-time energy/token trading, and administrative resource minting (Recharge).
* **API Bridge (Backend):** Written in Node.js (Express). Uses `@hyperledger/fabric-gateway` and gRPC to securely connect web requests to the blockchain's World State using X.509 cryptographic certificates.
* **Frontend UI (Dashboard):** Responsive HTML/JS dashboard that automatically queries the ledger for real-time balances and provides an immutable transaction history.

## 🚀 Features
1. **Automated Trading:** Smart contract rejects transactions if users have insufficient energy/tokens.
2. **Immutable Ledger:** Every trade is permanently recorded and cryptographically signed.
3. **Admin Gateway:** Allows authorized network administrators to mint energy/tokens to nodes.
4. **Real-Time Sync:** UI polls the blockchain directly, ensuring the displayed data is the absolute truth of the ledger.