// Package main is the entry point for the gaia api service.
//
// Bootstrap-only at this stage: domain modules will be wired in
// after the domain layer is approved (see project_gaia.md, EPIC 0
// step 2).
package main

import (
	"log/slog"
	"os"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	logger.Info("gaia api: bootstrap shell up — no modules wired yet")
}
