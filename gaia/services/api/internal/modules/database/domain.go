// Package database contains the Database domain entity — a logical
// data store the service connects to (Postgres, Mongo, Redis, etc.).
package database

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Engine enumerates the supported database engines.
type Engine string

const (
	EnginePostgres   Engine = "postgres"
	EngineMySQL      Engine = "mysql"
	EngineMongo      Engine = "mongo"
	EngineRedis      Engine = "redis"
	EngineDynamo     Engine = "dynamodb"
	EngineCassandra  Engine = "cassandra"
	EngineElastic    Engine = "elasticsearch"
	EngineSQLite     Engine = "sqlite"
	EngineSQLServer  Engine = "sqlserver"
	EngineUnknown    Engine = "unknown"
)

// Properties holds typed metadata for a Database node.
type Properties struct {
	ServiceID    shared.NodeID
	Engine       Engine
	ConnectionEnv string // env var name holding the conn string, never the value
	IsExternal   bool   // true when service points at someone else's DB
}

// Database is the aggregate that owns Tables and Columns.
type Database struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetEngine() Engine
}

// New builds a Database. Name is the logical db name (DB cluster
// schema, mongo db, redis instance label).
func New(serviceID shared.NodeID, name string, props Properties) (*Database, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if props.Engine == "" {
		props.Engine = EngineUnknown
	}
	id, err := shared.BuildDatabaseID(serviceID, name)
	if err != nil {
		return nil, err
	}
	props.ServiceID = serviceID
	return &Database{ID: id, Name: name, Properties: props}, nil
}

func (d *Database) GetID() shared.NodeID { return d.ID }
func (d *Database) GetName() string      { return d.Name }
func (d *Database) GetEngine() Engine    { return d.Properties.Engine }

// Repository persists Database nodes.
type Repository interface {
	Create(ctx context.Context, d *Database) error
	Update(ctx context.Context, d *Database) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Database, error)
	GetAll(ctx context.Context) ([]*Database, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Database, error)
	GetByEngine(ctx context.Context, engine Engine) ([]*Database, error)
}
