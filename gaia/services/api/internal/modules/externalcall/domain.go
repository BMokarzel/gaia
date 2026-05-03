// Package externalcall contains the ExternalCall domain entity — an
// outbound HTTP/RPC call from a Function to another service. The
// edge merge step (cross-service) tries to resolve targetServiceID.
package externalcall

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// MergeStatus captures the result of cross-service resolution.
type MergeStatus string

const (
	MergeUnresolved MergeStatus = "unresolved"
	MergeResolved   MergeStatus = "resolved"
	MergeAmbiguous  MergeStatus = "ambiguous"
)

// Properties holds typed metadata for an ExternalCall node.
type Properties struct {
	ParentFnID      shared.NodeID
	ServiceID       shared.NodeID // origin service (where the call lives)
	Method          string        // HTTP verb / RPC method
	BaseURL         string
	Path            string
	HTTPClient      string // axios / fetch / RestTemplate / ...
	TargetServiceID shared.NodeID // populated by merger; may be empty
	MergeStatus     MergeStatus
	PostorderIdx    int
}

// ExternalCall is an AST-internal node that lives inside a function
// body but represents an outbound dependency. It is promoted to a
// first-class node so cross-service edges can attach.
type ExternalCall struct {
	ID         shared.NodeID
	Name       string // "<METHOD> <baseURL><path>"
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
}

// New builds an ExternalCall. Path may be empty for clients that
// only know the base URL (rare — usually filled in).
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*ExternalCall, error) {
	if strings.TrimSpace(props.Method) == "" {
		return nil, fmt.Errorf("%w: method", shared.ErrMissingField)
	}
	if props.MergeStatus == "" {
		props.MergeStatus = MergeUnresolved
	}
	id, err := shared.BuildASTNodeID(parentFnID, "ext", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	props.Method = strings.ToUpper(props.Method)
	return &ExternalCall{
		ID:         id,
		Name:       fmt.Sprintf("%s %s%s", props.Method, props.BaseURL, props.Path),
		Properties: props,
	}, nil
}

func (e *ExternalCall) GetID() shared.NodeID         { return e.ID }
func (e *ExternalCall) GetName() string              { return e.Name }
func (e *ExternalCall) GetParentFnID() shared.NodeID { return e.Properties.ParentFnID }

// Repository persists ExternalCall nodes.
type Repository interface {
	Create(ctx context.Context, e *ExternalCall) error
	Update(ctx context.Context, e *ExternalCall) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*ExternalCall, error)
	GetAll(ctx context.Context) ([]*ExternalCall, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*ExternalCall, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*ExternalCall, error)
	GetByTargetService(ctx context.Context, targetServiceID shared.NodeID) ([]*ExternalCall, error)
	GetByMergeStatus(ctx context.Context, status MergeStatus) ([]*ExternalCall, error)
}
