package main

import (
	"encoding/json"
	"fmt"
	"log"
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
}

func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	nodes := []EnergyNode{
		{ID: "node1", Owner: "Alice", EnergyBalance: 100, TokenBalance: 500},
		{ID: "node2", Owner: "Bob", EnergyBalance: 20, TokenBalance: 1000},
	}
	for _, node := range nodes {
		nodeJSON, _ := json.Marshal(node)
		err := ctx.GetStub().PutState(node.ID, nodeJSON)
		if err != nil {
			return fmt.Errorf("failed to put to world state. %v", err)
		}
	}
	return nil
}

func (s *SmartContract) GetNode(ctx contractapi.TransactionContextInterface, id string) (*EnergyNode, error) {
	nodeJSON, err := ctx.GetStub().GetState(id)
	if err != nil || nodeJSON == nil {
		return nil, fmt.Errorf("node not found")
	}
	var node EnergyNode
	json.Unmarshal(nodeJSON, &node)
	return &node, nil
}

func (s *SmartContract) TradeEnergy(ctx contractapi.TransactionContextInterface, sellerID string, buyerID string, energyAmount int, tokenPrice int) error {
	seller, _ := s.GetNode(ctx, sellerID)
	buyer, _ := s.GetNode(ctx, buyerID)

	if seller.EnergyBalance < energyAmount {
		return fmt.Errorf("insufficient energy")
	}

	seller.EnergyBalance -= energyAmount
	seller.TokenBalance += tokenPrice
	buyer.EnergyBalance += energyAmount
	buyer.TokenBalance -= tokenPrice

	sJSON, _ := json.Marshal(seller)
	bJSON, _ := json.Marshal(buyer)
	ctx.GetStub().PutState(sellerID, sJSON)
	return ctx.GetStub().PutState(buyerID, bJSON)
}


// RechargeNode allows an admin to mint tokens and energy for a user
func (s *SmartContract) RechargeNode(ctx contractapi.TransactionContextInterface, id string, addedEnergy int, addedTokens int) error {
	node, err := s.GetNode(ctx, id)
	if err != nil {
		return err
	}

	// Add the new resources
	node.EnergyBalance += addedEnergy
	node.TokenBalance += addedTokens

	// Save back to the blockchain
	nodeJSON, _ := json.Marshal(node)
	return ctx.GetStub().PutState(id, nodeJSON)
}

func main() {
	assetChaincode, _ := contractapi.NewChaincode(&SmartContract{})
	if err := assetChaincode.Start(); err != nil {
		log.Panicf("Error starting chaincode: %v", err)
	}
}