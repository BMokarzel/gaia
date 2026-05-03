// Package flowcontrol contains the FlowControl AST-internal domain
// entity — an if/loop/switch/try construct inside a function body.
// Branches reference a ConditionExpr by id; child statements live
// under the FlowControl via parent_of edges.
package flowcontrol

import (
	"context"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Kind labels the control-flow construct.
type Kind string

const (
	KindIf       Kind = "if"
	KindLoop     Kind = "loop"   // for / while / for-of / for-in
	KindSwitch   Kind = "switch"
	KindTry      Kind = "try"
	KindTernary  Kind = "ternary"
)

// BranchKind labels which arm of a control-flow node a branch is.
type BranchKind string

const (
	BranchThen    BranchKind = "branch_then"
	BranchElse    BranchKind = "branch_else"
	BranchCase    BranchKind = "switch_case"
	BranchDefault BranchKind = "switch_default"
	BranchTryBody BranchKind = "try_body"
	BranchCatch   BranchKind = "catch"
	BranchFinally BranchKind = "finally"
	BranchLoopBody BranchKind = "loop_body"
)

// Branch is one arm of the control-flow node. ChildIDs are the
// nodes (Call/Throw/Return/...) that live inside that arm.
type Branch struct {
	Kind         BranchKind
	ConditionID  shared.NodeID // points to a ConditionExpr; empty for default/finally
	CaseValue    string        // for switch_case
	ChildIDs     []shared.NodeID
}

// FeatureFlag captures when a branch is gated by a runtime flag.
// Mirrors the TS feature-flag-detector output already in /tree.
type FeatureFlag struct {
	Name         string
	Source       string // "env"|"config"|"sdk"
	Provider     string // unleash / posthog / launchdarkly / ...
	DefaultValue any
}

// Properties holds typed metadata for a FlowControl node.
type Properties struct {
	ParentFnID   shared.NodeID
	Kind         Kind
	ConditionID  shared.NodeID // primary test (empty for switch / try)
	Branches     []Branch
	FeatureFlag  *FeatureFlag // populated by detector when applicable
	Conditional  bool         // nested inside another flow-control
	PostorderIdx int
}

// FlowControl is the persisted AST internal for a control-flow node.
type FlowControl struct {
	ID         shared.NodeID
	Name       string // e.g. "if (input.force)"
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetKind() Kind
}

// New builds a FlowControl. Branch shapes vary by kind; the
// constructor enforces minimal expectations only (e.g. switch must
// have at least one case or default).
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*FlowControl, error) {
	if props.Kind == "" {
		return nil, fmt.Errorf("%w: kind", shared.ErrMissingField)
	}
	if props.Kind == KindSwitch && len(props.Branches) == 0 {
		return nil, fmt.Errorf("%w: switch requires at least one branch", shared.ErrInvalidValue)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "fc", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	return &FlowControl{ID: id, Name: string(props.Kind), Properties: props}, nil
}

func (f *FlowControl) GetID() shared.NodeID         { return f.ID }
func (f *FlowControl) GetName() string              { return f.Name }
func (f *FlowControl) GetParentFnID() shared.NodeID { return f.Properties.ParentFnID }
func (f *FlowControl) GetKind() Kind                { return f.Properties.Kind }

// Repository persists FlowControl nodes.
type Repository interface {
	Create(ctx context.Context, f *FlowControl) error
	Update(ctx context.Context, f *FlowControl) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*FlowControl, error)
	GetAll(ctx context.Context) ([]*FlowControl, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*FlowControl, error)
	GetByKind(ctx context.Context, kind Kind) ([]*FlowControl, error)
	GetWithFeatureFlag(ctx context.Context) ([]*FlowControl, error)
}
