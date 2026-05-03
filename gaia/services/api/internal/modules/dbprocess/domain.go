// Package dbprocess contains the DbProcess domain entity — a single
// database operation observed in code (find/findMany/insert/update/...).
// Anchors a Function to a Table via reads_from / writes_to edges.
package dbprocess

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Operation enumerates the operations the analyser recognises.
// Subset shared between SQL ORMs (Prisma/TypeORM/Knex) and Mongo
// drivers; adapters map their dialect onto this set.
type Operation string

const (
	OpFind        Operation = "find"
	OpFindMany    Operation = "findMany"
	OpFindUnique  Operation = "findUnique"
	OpFindFirst   Operation = "findFirst"
	OpCreate      Operation = "create"
	OpCreateMany  Operation = "createMany"
	OpUpdate      Operation = "update"
	OpUpdateMany  Operation = "updateMany"
	OpUpsert      Operation = "upsert"
	OpDelete      Operation = "delete"
	OpDeleteMany  Operation = "deleteMany"
	OpCount       Operation = "count"
	OpGroupBy     Operation = "groupBy"
	OpAggregate   Operation = "aggregate"
	OpRaw         Operation = "raw"
	OpTransaction Operation = "transaction"
)

// IsRead reports whether the op is read-only (drives reads_from
// vs writes_to edge selection).
func (o Operation) IsRead() bool {
	switch o {
	case OpFind, OpFindMany, OpFindUnique, OpFindFirst, OpCount, OpGroupBy, OpAggregate:
		return true
	default:
		return false
	}
}

// Properties holds typed metadata for a DbProcess node.
type Properties struct {
	ParentFnID    shared.NodeID
	TableID       shared.NodeID // empty for raw / transaction
	DatabaseID    shared.NodeID
	Operation     Operation
	ReturnShapeID shared.NodeID // populated by db-shape-inferrer
	Conditional   bool          // inside if/loop/switch/try
	PostorderIdx  int
}

// DbProcess is an AST-internal node tracking one DB op.
type DbProcess struct {
	ID         shared.NodeID
	Name       string // "<op> <table>"
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetOperation() Operation
}

// New builds a DbProcess.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*DbProcess, error) {
	if strings.TrimSpace(string(props.Operation)) == "" {
		return nil, fmt.Errorf("%w: operation", shared.ErrMissingField)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "dbp", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	return &DbProcess{
		ID:         id,
		Name:       fmt.Sprintf("%s %s", props.Operation, props.TableID),
		Properties: props,
	}, nil
}

func (d *DbProcess) GetID() shared.NodeID         { return d.ID }
func (d *DbProcess) GetName() string              { return d.Name }
func (d *DbProcess) GetParentFnID() shared.NodeID { return d.Properties.ParentFnID }
func (d *DbProcess) GetOperation() Operation      { return d.Properties.Operation }

// Repository persists DbProcess nodes.
type Repository interface {
	Create(ctx context.Context, d *DbProcess) error
	Update(ctx context.Context, d *DbProcess) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*DbProcess, error)
	GetAll(ctx context.Context) ([]*DbProcess, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*DbProcess, error)
	GetByTable(ctx context.Context, tableID shared.NodeID) ([]*DbProcess, error)
	GetByDatabase(ctx context.Context, databaseID shared.NodeID) ([]*DbProcess, error)
	GetByOperation(ctx context.Context, op Operation) ([]*DbProcess, error)
}
