// Package class contains the Class domain entity — a class/struct
// declaration in source. Methods anchor onto a Class.
package class

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Class node.
type Properties struct {
	ServiceID  shared.NodeID
	File       string
	Line       int
	Decorators []string        // e.g. @Controller, @Injectable
	MethodIDs  []shared.NodeID // populated as Methods are linked
	IsExported bool
}

// Class represents an OO class declaration (TS/Java/Python/etc.).
type Class struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface is the contract used by aggregates that hold classes.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetServiceID() shared.NodeID
}

// New constructs a Class with id "cls:<svcID>:<file>:<symbolPath>".
func New(serviceID shared.NodeID, symbolPath string, props Properties) (*Class, error) {
	if strings.TrimSpace(symbolPath) == "" {
		return nil, fmt.Errorf("%w: symbolPath", shared.ErrMissingField)
	}
	if props.File == "" {
		return nil, fmt.Errorf("%w: file", shared.ErrMissingField)
	}
	id, err := shared.BuildClassID(serviceID, props.File, symbolPath)
	if err != nil {
		return nil, err
	}
	props.ServiceID = serviceID
	return &Class{ID: id, Name: symbolPath, Properties: props}, nil
}

func (c *Class) GetID() shared.NodeID        { return c.ID }
func (c *Class) GetName() string             { return c.Name }
func (c *Class) GetServiceID() shared.NodeID { return c.Properties.ServiceID }

// Repository persists Class nodes.
type Repository interface {
	Create(ctx context.Context, c *Class) error
	Update(ctx context.Context, c *Class) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Class, error)
	GetAll(ctx context.Context) ([]*Class, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Class, error)
	GetByFile(ctx context.Context, serviceID shared.NodeID, file string) ([]*Class, error)
}
