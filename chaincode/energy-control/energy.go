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
	LockedEnergy  int    `json:"LockedEnergy"`  // NEW: Escrow tracking
	LockedTokens  int    `json:"LockedTokens"`  // NEW: Escrow tracking
	LastAction    string `json:"LastAction"`    // NEW: Audit context
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
	node, _ := s.GetNode(ctx, id)
	node.EnergyBalance += amount
	node.TokenBalance += amount
	node.LastAction = fmt.Sprintf("Admin Recharge: +%d", amount) // Context!
	
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
	node, _ := s.GetNode(ctx, owner)

	// 1. ESCROW: Move to Locked instead of just subtracting!
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

	// 2. Add to Order Book
	orders, _ := s.GetOrderBook(ctx)
	orders = append(orders, Order{ID: id, Owner: owner, OrderType: orderType, Price: price, Quantity: quantity})

	// 3. Run Matching Engine
	orders = s.matchOrders(ctx, orders)

	newObJSON, _ := json.Marshal(orders)
	return ctx.GetStub().PutState(OrderBookKey, newObJSON)
}

func (s *SmartContract) matchOrders(ctx contractapi.TransactionContextInterface, orders []Order) []Order {
	for i := 0; i < len(orders); i++ {
		for j := i + 1; j < len(orders); j++ {
			buyOrder := &orders[i]
			sellOrder := &orders[j]

			if buyOrder.OrderType == sellOrder.OrderType { continue }
			if buyOrder.OrderType == "SELL" { buyOrder, sellOrder = sellOrder, buyOrder }

			if buyOrder.Price >= sellOrder.Price && buyOrder.Quantity > 0 && sellOrder.Quantity > 0 {
				tradeQty := buyOrder.Quantity
				if sellOrder.Quantity < tradeQty { tradeQty = sellOrder.Quantity }
				settlementPrice := sellOrder.Price 

				buyOrder.Quantity -= tradeQty
				sellOrder.Quantity -= tradeQty

				buyerNode, _ := s.GetNode(ctx, buyOrder.Owner)
				sellerNode, _ := s.GetNode(ctx, sellOrder.Owner)

				// Settle Escrows!
				buyerCost := settlementPrice * tradeQty
				buyerRefund := (buyOrder.Price * tradeQty) - buyerCost

				// Buyer gets energy, releases locked tokens, gets refund if matched cheaper
				buyerNode.LockedTokens -= (buyOrder.Price * tradeQty)
				buyerNode.EnergyBalance += tradeQty
				buyerNode.TokenBalance += buyerRefund 
				buyerNode.LastAction = fmt.Sprintf("Trade Execution: Bought %d kWh", tradeQty)

				// Seller gets tokens, releases locked energy
				sellerNode.LockedEnergy -= tradeQty
				sellerNode.TokenBalance += buyerCost
				sellerNode.LastAction = fmt.Sprintf("Trade Execution: Sold %d kWh", tradeQty)

				bJSON, _ := json.Marshal(buyerNode)
				sJSON, _ := json.Marshal(sellerNode)
				ctx.GetStub().PutState(buyOrder.Owner, bJSON)
				ctx.GetStub().PutState(sellOrder.Owner, sJSON)
			}
		}
	}

	var activeOrders []Order
	for _, o := range orders {
		if o.Quantity > 0 { activeOrders = append(activeOrders, o) }
	}
	return activeOrders
}

func main() {
	assetChaincode, _ := contractapi.NewChaincode(&SmartContract{})
	if err := assetChaincode.Start(); err != nil { log.Panicf("Error starting chaincode: %v", err) }
}