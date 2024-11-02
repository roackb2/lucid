milvus-url = milvus-standalone.orb.local:19530

# Recursively find all Go files in cmd and its subfolders
GO_FILES := $(shell find cmd -name '*.go')

# Extract unique directory names from GO_FILES
CMD_DIRS := $(sort $(dir $(GO_FILES)))

# Build all executables in the cmd folder and its subfolders
build:
	@for dir in $(CMD_DIRS); do \
		app_name=$$(echo $$dir | sed 's|cmd/||g' | sed 's|/$$||' | tr '/' '_'); \
		echo "Building $$app_name..."; \
		go build -o bin/$$app_name ./$$dir; \
	done

# Generate run targets for each executables
define generate_run_target
$(1): generate-db-models swagger build
	./bin/$(1) $(ARGS)
endef

# Find all executables in the bin folder and create run targets
EXECUTABLES := $(notdir $(wildcard bin/*))
$(foreach exec,$(EXECUTABLES),$(eval $(call generate_run_target,$(exec))))

test:
	go test ./... -v

.PHONY: test

# Clean up build artifacts
clean:
	rm -f bin/*

# Build Swagger documentation
swagger:
	@echo "Current directory: $$(pwd)"
	@echo "Generating Swagger documentation..."
	@which swag > /dev/null || (echo "swag not found. Installing..." && go install github.com/swaggo/swag/cmd/swag@latest)
	@echo "Running swag init..."
	@swag init -g main.go -d ./cmd/server,./internal/app/controllers -o api/swagger

.PHONY: build clean swagger $(addprefix run-,$(EXECUTABLES))

generate-db-models:
	@echo "Generating database models..."
	@sqlc generate -f database/sqlc.yml

generate-mocks:
	mockgen -source internal/pkg/agents/storage/type.go -destination test/_mocks/storage/mock_type.go
	mockgen -source internal/pkg/control_plane/type.go -destination test/_mocks/control_plane/mock_type.go
	mockgen -source internal/pkg/agents/worker/type.go -destination test/_mocks/worker/mock_type.go
	mockgen -source internal/pkg/agents/providers/type.go -destination test/_mocks/providers/mock_type.go
	mockgen -source internal/pkg/agents/type.go -destination test/_mocks/agents/mock_type.go

# Run migrations up
migrate-up: build
	./bin/migrate -up -dump

# Run migrations down
migrate-down: build
	./bin/migrate -down -dump

run-server: generate-db-models swagger build
	./bin/server

start-milvus:
	cd milvus && ./standalone_embed.sh start

stop-milvus:
	cd milvus && ./standalone_embed.sh stop

run-milvus-gui:
	docker run --rm -p 8000:3000 -e MILVUS_URL=${milvus-url} zilliz/attu:v2.4
