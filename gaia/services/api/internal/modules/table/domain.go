// Package table contains the Table domain entity — a relation /
// collection inside a Database. Columns anchor onto a Table.
package table

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Table node.
type Properties struct {
	DatabaseID shared.NodeID
	Schema     string // "public" by default
	ColumnIDs  []shared.NodeID
	IsView     bool
	Comment    string
}

// Table represents a SQL relation or a Mongo collection. The shape
// of its rows is captured in linked Column nodes; for schema-less
// stores, fields[] live in the Column projection too.
type Table struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetDatabaseID() shared.NodeID
}

// New builds a Table. Schema empty falls back to "public".
func New(databaseID shared.NodeID, schema, name string, props Properties) (*Table, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if strings.TrimSpace(schema) == "" {
		schema = "public"
	}
	id, err := shared.BuildTableID(databaseID, schema, name)
	if err != nil {
		return nil, err
	}
	props.DatabaseID = databaseID
	props.Schema = schema
	return &Table{ID: id, Name: name, Properties: props}, nil
}

func (t *Table) GetID() shared.NodeID         { return t.ID }
func (t *Table) GetName() string              { return t.Name }
func (t *Table) GetDatabaseID() shared.NodeID { return t.Properties.DatabaseID }

// Repository persists Table nodes.
type Repository interface {
	Create(ctx context.Context, t *Table) error
	Update(ctx context.Context, t *Table) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Table, error)
	GetAll(ctx context.Context) ([]*Table, error)
	GetByDatabase(ctx context.Context, databaseID shared.NodeID) ([]*Table, error)
	GetBySchemaName(ctx context.Context, databaseID shared.NodeID, schema, name string) (*Table, error)
}
