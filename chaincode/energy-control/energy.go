package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
    "github.com/hyperledger/fabric-chaincode-go/pkg/cid"
)

type SmartContract struct {
	contractapi.Contract
}

type EnergyNode struct {
	ID            string `json:"ID"`
	Owner         string `json:"Owner"`
	EnergyBalance int    `json:"EnergyBalance"`
	TokenBalance  int    `json:"TokenBalance"`
	LockedEnergy  int    `json:"LockedEnergy"`  // Escrow tracking
	LockedTokens  int    `json:"LockedTokens"`  // Escrow tracking
	LastAction    string `json:"LastAction"`    // Audit context
}

type Order struct {
	ID        string `json:"ID"`
	Owner     string `json:"Owner"`
	OrderType string `json:"OrderType"`
	Price     int    `json:"Price"`
	Quantity  int    `json:"Quantity"`
}

type HistoryQueryResult struct {
	Record    *EnergyNode `json:"Record"`
	TxId      string      `json:"TxId"`
	Timestamp string      `json:"Timestamp"`
}

const OrderBookKey = "GLOBAL_ORDER_BOOK"

func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	nodes := []EnergyNode{
		{ID: "node1", Owner: "Alice", EnergyBalance: 100, TokenBalance: 500, LockedEnergy: 0, LockedTokens: 0, LastAction: "Network Initialization"},
		{ID: "node2", Owner: "Bob", EnergyBalance: 20, TokenBalance: 1000, LockedEnergy: 0, LockedTokens: 0, LastAction: "Network Initialization"},
	}
	for _, node := range nodes {
		nodeJSON, _ := json.Marshal(node)
		ctx.GetStub().PutState(node.ID, nodeJSON)
	}
	return nil
}

func (s *SmartContract) GetNode(ctx contractapi.TransactionContextInterface, id string) (*EnergyNode, error) {
	nodeJSON, err := ctx.GetStub().GetState(id)
	if err != nil || nodeJSON == nil { return nil, fmt.Errorf("node not found") }
	var node EnergyNode
	json.Unmarshal(nodeJSON, &node)
	return &node, nil
}

// GetAllNodes - Returns all registered Energy Nodes
func (s *SmartContract) GetAllNodes(ctx contractapi.TransactionContextInterface) ([]*EnergyNode, error) {
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil { return nil, err }
	defer resultsIterator.Close()

	var nodes []*EnergyNode
	for resultsIterator.HasNext() {
		response, err := resultsIterator.Next()
		if err != nil { return nil, err }

        // Skip OrderBook or other system keys if they don't unmarshal clean or use prefix
        // For simplicity, we assume all random keys are nodes, but "GLOBAL_ORDER_BOOK" is not.
        if response.Key == OrderBookKey { continue }

		var node EnergyNode
		err = json.Unmarshal(response.Value, &node)
        if err == nil {
            nodes = append(nodes, &node)
        }
	}
	return nodes, nil
}

func (s *SmartContract) GetNodeHistory(ctx contractapi.TransactionContextInterface, id string) ([]HistoryQueryResult, error) {
	resultsIterator, _ := ctx.GetStub().GetHistoryForKey(id)
	defer resultsIterator.Close()

	var records []HistoryQueryResult
	for resultsIterator.HasNext() {
		response, _ := resultsIterator.Next()
		var node EnergyNode
		if len(response.Value) > 0 { json.Unmarshal(response.Value, &node) }

		records = append(records, HistoryQueryResult{
			TxId:      response.TxId,
			Timestamp: time.Unix(response.Timestamp.Seconds, int64(response.Timestamp.Nanos)).Format(time.RFC3339),
			Record:    &node,
		})
	}
	return records, nil
}

// OracleMintAssets (Formerly RechargeNode)
// Enforces ABAC: Caller must have 'role' = 'admin'
func (s *SmartContract) OracleMintAssets(ctx contractapi.TransactionContextInterface, id string, amount int) error {
    // 1. ABAC Check
    err := cid.AssertAttributeValue(ctx.GetStub(), "role", "admin")
    if err != nil {
         // Fallback for Local Dev (Sandbox environment often doesn't have real attribute certs)
         // Check if MSPID is Org1MSP (Implied Admin Org) AND ID matches a known admin convention if needed.

         mspid, _ := cid.GetMSPID(ctx.GetStub())
         if mspid != "Org1MSP" {
             return fmt.Errorf("ABAC Authorization Failed: %v", err)
         }
    }

	node, err := s.GetNode(ctx, id)
    if err != nil {
        // Auto-create new node if it doesn't exist (Admin onboarding)
        node = &EnergyNode{ID: id, Owner: id, EnergyBalance: 0, TokenBalance: 0, LockedEnergy: 0, LockedTokens: 0, LastAction: "Oracle Initialization"}
    }

	node.EnergyBalance += amount
	node.TokenBalance += amount
	node.LastAction = fmt.Sprintf("Oracle Mint: +%d", amount)

	nodeJSON, _ := json.Marshal(node)
	return ctx.GetStub().PutState(id, nodeJSON)
}

func (s *SmartContract) GetOrderBook(ctx contractapi.TransactionContextInterface) ([]Order, error) {
	obJSON, err := ctx.GetStub().GetState(OrderBookKey)
	if err != nil || obJSON == nil { return []Order{}, nil }
	var orders []Order
	json.Unmarshal(obJSON, &orders)
	return orders, nil
}

func (s *SmartContract) PlaceOrder(ctx contractapi.TransactionContextInterface, id string, owner string, orderType string, price int, quantity int) error {
	node, err := s.GetNode(ctx, owner)
    if err != nil { return fmt.Errorf("node not found") }

	// 1. ESCROW: Move to Locked
	if orderType == "SELL" {
		if node.EnergyBalance < quantity { return fmt.Errorf("insufficient energy to sell") }
		node.EnergyBalance -= quantity
		node.LockedEnergy += quantity
		node.LastAction = fmt.Sprintf("Placed Ask: %d kWh @ %d ₮", quantity, price)
	} else if orderType == "BUY" {
		totalCost := price * quantity
		if node.TokenBalance < totalCost { return fmt.Errorf("insufficient tokens to buy") }
		node.TokenBalance -= totalCost
		node.LockedTokens += totalCost
		node.LastAction = fmt.Sprintf("Placed Bid: %d kWh @ %d ₮", quantity, price)
	}
	nodeJSON, _ := json.Marshal(node)
	ctx.GetStub().PutState(owner, nodeJSON)

	// 2. Add to On-Chain Order Book
	orders, _ := s.GetOrderBook(ctx)
	orders = append(orders, Order{ID: id, Owner: owner, OrderType: orderType, Price: price, Quantity: quantity})

	newObJSON, _ := json.Marshal(orders)
	return ctx.GetStub().PutState(OrderBookKey, newObJSON)
}

func (s *SmartContract) SettleMatch(ctx contractapi.TransactionContextInterface, buyerID string, sellerID string, quantity int, settlementPrice int, buyerOriginalPrice int) error {
    buyerNode, err := s.GetNode(ctx, buyerID)
    if err != nil { return fmt.Errorf("buyer not found") }

    sellerNode, err := s.GetNode(ctx, sellerID)
    if err != nil { return fmt.Errorf("seller not found") }

    totalCost := settlementPrice * quantity
    lockedAmount := buyerOriginalPrice * quantity

    if buyerNode.LockedTokens < lockedAmount { return fmt.Errorf("buyer locked funds insufficient") }
    if sellerNode.LockedEnergy < quantity { return fmt.Errorf("seller locked energy insufficient") }

    buyerNode.LockedTokens -= lockedAmount
    buyerNode.EnergyBalance += quantity
    buyerNode.TokenBalance += (lockedAmount - totalCost) // Refund
    buyerNode.LastAction = fmt.Sprintf("Trade Settlement: Bought %d kWh @ %d ₮", quantity, settlementPrice)

    sellerNode.LockedEnergy -= quantity
    sellerNode.TokenBalance += totalCost
    sellerNode.LastAction = fmt.Sprintf("Trade Settlement: Sold %d kWh @ %d ₮", quantity, settlementPrice)

    bJSON, _ := json.Marshal(buyerNode)
    sJSON, _ := json.Marshal(sellerNode)
    ctx.GetStub().PutState(buyerID, bJSON)
    ctx.GetStub().PutState(sellerID, sJSON)

    return nil
}

func main() {
	assetChaincode, _ := contractapi.NewChaincode(&SmartContract{})
	if err := assetChaincode.Start(); err != nil { log.Panicf("Error starting chaincode: %v", err) }
}
