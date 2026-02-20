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
	LockedEnergy  int    `json:"LockedEnergy"`
	LockedTokens  int    `json:"LockedTokens"`
	LastAction    string `json:"LastAction"`
}

type Order struct {
	ID        string `json:"ID"`
	Owner     string `json:"Owner"`
	OrderType string `json:"OrderType"`
	Price     int    `json:"Price"`
	Quantity  int    `json:"Quantity"`
}

type P2PTrade struct {
    ID       string `json:"ID"`
    Seller   string `json:"Seller"`
    Quantity int    `json:"Quantity"`
    Price    int    `json:"Price"`
    Status   string `json:"Status"` // OPEN, COMPLETED
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

func (s *SmartContract) GetAllNodes(ctx contractapi.TransactionContextInterface) ([]*EnergyNode, error) {
	resultsIterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil { return nil, err }
	defer resultsIterator.Close()

	var nodes []*EnergyNode
	for resultsIterator.HasNext() {
		response, err := resultsIterator.Next()
		if err != nil { return nil, err }
        if response.Key == OrderBookKey || len(response.Key) > 6 && response.Key[0:6] == "TRADE_" { continue }

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

// OracleMintAssets / MintTokens
func (s *SmartContract) OracleMintAssets(ctx contractapi.TransactionContextInterface, id string, amount int) error {
    errAttribute := cid.AssertAttributeValue(ctx.GetStub(), "role", "admin")
    if errAttribute != nil {
        mspid, errMsp := cid.GetMSPID(ctx.GetStub())
        if errMsp != nil { return fmt.Errorf("failed to get MSPID: %v", errMsp) }
        cert, errCert := cid.GetX509Certificate(ctx.GetStub())
        if errCert != nil { return fmt.Errorf("failed to get certificate: %v", errCert) }
        if mspid != "Org1MSP" || cert.Subject.CommonName != "admin" {
            return fmt.Errorf("ABAC Denied: %v. Fallback Denied: MSP=%s, CN=%s", errAttribute, mspid, cert.Subject.CommonName)
        }
    }

	node, err := s.GetNode(ctx, id)
    if err != nil {
        node = &EnergyNode{ID: id, Owner: id, EnergyBalance: 0, TokenBalance: 0, LockedEnergy: 0, LockedTokens: 0, LastAction: "Oracle Initialization"}
    }

	node.EnergyBalance += amount
	node.TokenBalance += amount // For simplicity, minting usually adds tokens or energy. "Recharge" implies tokens? Or both? Original code did both.
	node.LastAction = fmt.Sprintf("Oracle Mint: +%d", amount)

	nodeJSON, _ := json.Marshal(node)
	return ctx.GetStub().PutState(id, nodeJSON)
}

func (s *SmartContract) MintTokens(ctx contractapi.TransactionContextInterface, id string, amount int) error {
    return s.OracleMintAssets(ctx, id, amount)
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
    buyerNode.TokenBalance += (lockedAmount - totalCost)
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

// Enterprise P2P Trade: Create (Lock Energy)
func (s *SmartContract) CreateP2PTrade(ctx contractapi.TransactionContextInterface, tradeID string, sellerID string, quantity int, price int) error {
    // 1. Lock Seller Energy
    seller, err := s.GetNode(ctx, sellerID)
    if err != nil { return fmt.Errorf("seller not found") }

    if seller.EnergyBalance < quantity { return fmt.Errorf("insufficient energy balance") }

    seller.EnergyBalance -= quantity
    seller.LockedEnergy += quantity
    seller.LastAction = fmt.Sprintf("P2P Trade Created: %s", tradeID)

    // Save Seller
    sJSON, _ := json.Marshal(seller)
    ctx.GetStub().PutState(sellerID, sJSON)

    // 2. Create Trade Record
    trade := P2PTrade{
        ID: tradeID, Seller: sellerID, Quantity: quantity, Price: price, Status: "OPEN",
    }
    tradeJSON, _ := json.Marshal(trade)
    return ctx.GetStub().PutState("TRADE_"+tradeID, tradeJSON)
}

// Enterprise P2P Trade: Complete (Unlock Energy to Buyer, Transfer Tokens)
func (s *SmartContract) CompleteP2PTrade(ctx contractapi.TransactionContextInterface, tradeID string, buyerID string) error {
    // 1. Get Trade
    tradeJSON, err := ctx.GetStub().GetState("TRADE_"+tradeID)
    if err != nil || tradeJSON == nil { return fmt.Errorf("trade not found") }
    var trade P2PTrade
    json.Unmarshal(tradeJSON, &trade)

    if trade.Status != "OPEN" { return fmt.Errorf("trade not open") }

    // 2. Get Buyer and Seller
    buyer, err := s.GetNode(ctx, buyerID)
    if err != nil { return fmt.Errorf("buyer not found") }

    seller, err := s.GetNode(ctx, trade.Seller)
    if err != nil { return fmt.Errorf("seller not found") }

    // 3. Check Buyer Funds
    cost := trade.Price * trade.Quantity
    if buyer.TokenBalance < cost { return fmt.Errorf("insufficient buyer tokens") }

    // 4. Transfer
    buyer.TokenBalance -= cost
    buyer.EnergyBalance += trade.Quantity
    buyer.LastAction = fmt.Sprintf("P2P Trade Completed: %s", tradeID)

    seller.TokenBalance += cost
    seller.LockedEnergy -= trade.Quantity
    seller.LastAction = fmt.Sprintf("P2P Trade Completed: %s", tradeID)

    // 5. Save States
    bJSON, _ := json.Marshal(buyer)
    sJSON, _ := json.Marshal(seller)
    ctx.GetStub().PutState(buyerID, bJSON)
    ctx.GetStub().PutState(trade.Seller, sJSON)

    // 6. Close Trade
    trade.Status = "COMPLETED"
    newTradeJSON, _ := json.Marshal(trade)
    return ctx.GetStub().PutState("TRADE_"+tradeID, newTradeJSON)
}

func main() {
	assetChaincode, _ := contractapi.NewChaincode(&SmartContract{})
	if err := assetChaincode.Start(); err != nil { log.Panicf("Error starting chaincode: %v", err) }
}
