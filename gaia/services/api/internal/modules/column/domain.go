// Package column contains the Column domain entity — a typed field
// inside a Table.
package column

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Column node.
type Properties struct {
	TableID       shared.NodeID
	DataType      string // raw SQL/Mongo type ("varchar(255)", "uuid", "ObjectId", ...)
	Nullable      bool
	IsPrimaryKey  bool
	IsUnique      bool
	AutoIncrement bool
	DefaultValue  *string  // nil → no default; pointer disambiguates "" from missing
	EnumValues    []string // for enum columns
	Comment       string
}

// Column is the leaf node beneath a Table. Reads/writes from a fn
// reach Columns transitively through DbProcess.
type Column struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetTableID() shared.NodeID
	GetDataType() string
}

// New builds a Column.
func New(tableID shared.NodeID, name string, props Properties) (*Column, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if strings.TrimSpace(props.DataType) == "" {
		return nil, fmt.Errorf("%w: dataType", shared.ErrMissingField)
	}
	id, err := shared.BuildColumnID(tableID, name)
	if err != nil {
		return nil, err
	}
	props.TableID = tableID
	return &Column{ID: id, Name: name, Properties: props}, nil
}

func (c *Column) GetID() shared.NodeID      { return c.ID }
func (c *Column) GetName() string           { return c.Name }
func (c *Column) GetTableID() shared.NodeID { return c.Properties.TableID }
func (c *Column) GetDataType() string       { return c.Properties.DataType }

// Repository persists Column nodes.
type Repository interface {
	Create(ctx context.Context, c *Column) error
	Update(ctx context.Context, c *Column) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Column, error)
	GetAll(ctx context.Context) ([]*Column, error)
	GetByTable(ctx context.Context, tableID shared.NodeID) ([]*Column, error)
}
