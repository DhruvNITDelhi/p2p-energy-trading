package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
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
	// Initialize with some default nodes if needed, or leave empty
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

func (s *SmartContract) RechargeNode(ctx contractapi.TransactionContextInterface, id string, amount int) error {
	node, err := s.GetNode(ctx, id)
    if err != nil {
        // If node doesn't exist, maybe create it?
        // For strictness, fail. But let's auto-create for admin ease if needed.
        // Or assume ID matches an enrolled user.
        // Let's create if not exists.
        node = &EnergyNode{ID: id, Owner: id, EnergyBalance: 0, TokenBalance: 0, LockedEnergy: 0, LockedTokens: 0, LastAction: "Created via Recharge"}
    }

	node.EnergyBalance += amount
	node.TokenBalance += amount
	node.LastAction = fmt.Sprintf("Admin Recharge: +%d", amount)

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

// PlaceOrder: Now only locks funds/energy and records order intent.
// Matching happens off-chain.
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

	// 2. Add to On-Chain Order Book (Optional if purely off-chain, but good for transparency/audit)
    // We keep it for now.
	orders, _ := s.GetOrderBook(ctx)
	orders = append(orders, Order{ID: id, Owner: owner, OrderType: orderType, Price: price, Quantity: quantity})

	newObJSON, _ := json.Marshal(orders)
	return ctx.GetStub().PutState(OrderBookKey, newObJSON)
}

// SettleMatch: Executed by the off-chain matching engine to finalize a trade.
// args: buyerID, sellerID, quantity, settlementPrice, buyerOriginalPrice
func (s *SmartContract) SettleMatch(ctx contractapi.TransactionContextInterface, buyerID string, sellerID string, quantity int, settlementPrice int, buyerOriginalPrice int) error {
    buyerNode, err := s.GetNode(ctx, buyerID)
    if err != nil { return fmt.Errorf("buyer not found") }

    sellerNode, err := s.GetNode(ctx, sellerID)
    if err != nil { return fmt.Errorf("seller not found") }

    // Calculate Costs
    totalCost := settlementPrice * quantity

    // Buyer Logic:
    // Buyer locked 'buyerOriginalPrice * quantity'.
    // Actual cost is 'settlementPrice * quantity'.
    // Refund = Locked - Actual Cost.
    lockedAmount := buyerOriginalPrice * quantity
    if buyerNode.LockedTokens < lockedAmount {
        return fmt.Errorf("buyer locked funds insufficient/corrupted")
    }

    refund := lockedAmount - totalCost

    buyerNode.LockedTokens -= lockedAmount
    buyerNode.EnergyBalance += quantity
    buyerNode.TokenBalance += refund
    buyerNode.LastAction = fmt.Sprintf("Trade Settlement: Bought %d kWh @ %d ₮", quantity, settlementPrice)

    // Seller Logic:
    // Seller locked 'quantity' Energy.
    // Seller receives 'totalCost' Tokens.
    if sellerNode.LockedEnergy < quantity {
        return fmt.Errorf("seller locked energy insufficient/corrupted")
    }

    sellerNode.LockedEnergy -= quantity
    sellerNode.TokenBalance += totalCost
    sellerNode.LastAction = fmt.Sprintf("Trade Settlement: Sold %d kWh @ %d ₮", quantity, settlementPrice)

    // Save States
    bJSON, _ := json.Marshal(buyerNode)
    sJSON, _ := json.Marshal(sellerNode)
    ctx.GetStub().PutState(buyerID, bJSON)
    ctx.GetStub().PutState(sellerID, sJSON)

    // Update Order Book (Remove filled quantity) --
    // This is tricky. If off-chain manages the book, do we need to update on-chain book?
    // If we keep on-chain book for transparency, we should reduce quantity there too.
    // But finding the specific order is hard without OrderID.
    // For this iteration, we assume On-Chain Book is just an append-log of intents,
    // and the "State" (Balances) is the source of truth.
    // Ideally, we'd pass OrderIDs to this function to update the book records too.
    // Let's leave the OrderBook cleanup for a separate 'Cleanup' process or assume it's just a log.

    return nil
}

func main() {
	assetChaincode, _ := contractapi.NewChaincode(&SmartContract{})
	if err := assetChaincode.Start(); err != nil { log.Panicf("Error starting chaincode: %v", err) }
}
