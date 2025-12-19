---
name: effect
description: Effect TypeScript library for functional effects, dependency injection, error handling, and async workflows. Use when working with Effect code in Tauri/TypeScript contexts.
---

# Effect TypeScript

Effect is a TypeScript library for building robust applications with functional programming patterns, focusing on type-safe error handling, dependency injection, and composable effects.

## Core Concepts

### Effect Type

The `Effect<A, E, R>` type represents a computation that:
- Produces a value of type `A` on success
- May fail with error type `E`
- Requires dependencies (context) of type `R`

```typescript
import { Effect } from "effect";

// Effect<string, never, never> - success with string, no errors, no dependencies
const hello = Effect.succeed("Hello");

// Effect<number, Error, never> - may fail with Error
const divide = (a: number, b: number): Effect.Effect<number, Error> =>
  b === 0
    ? Effect.fail(new Error("Division by zero"))
    : Effect.succeed(a / b);
```

## Effect.gen Pattern

Use `Effect.gen` for sequential effect composition with generator syntax. This is the primary pattern for working with multiple effects.

```typescript
import { Effect } from "effect";

export function processData(): Effect.Effect<Result, Error, FileSystem> {
  return Effect.gen(function* () {
    // Yield effects to unwrap values
    const fs = yield* FileSystem.FileSystem;
    const config = yield* loadConfig();
    const data = yield* fetchData(config.url);

    // Early return on conditions
    if (data.length === 0) {
      return yield* Effect.fail(new Error("No data"));
    }

    // Use regular TypeScript control flow
    const processed = data.map(transform);
    yield* saveResults(processed);

    return { count: processed.length, data: processed };
  });
}
```

### Key Rules for Effect.gen

1. Always yield effects with `yield*` (not `yield`)
2. Use `return yield* Effect.fail(...)` for early errors
3. Use regular TypeScript for conditionals, loops, maps
4. Unwrapped values are regular TypeScript types
5. Effects execute sequentially in order

## Services and Dependency Injection

### Defining Services

Use `Context.Tag` to define injectable services:

```typescript
import { Context } from "effect";

// Service with single value
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  { readonly apiUrl: string; readonly timeout: number }
>() {}

// Service with methods and state
export class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  {
    readonly query: (sql: string) => Effect.Effect<Row[], DatabaseError>;
    readonly connection: Connection;
  }
>() {}
```

### Service Naming Convention

- Service class names end with `Service` (e.g., `FpDirService`, `HonoWebService`)
- Tag names match class names (passed as string to `Context.Tag`)
- Service interfaces use `readonly` fields
- Keep services focused and single-purpose

### Using Services

Access services in Effect.gen:

```typescript
export function fetchUser(id: string): Effect.Effect<User, Error, ConfigService | DatabaseService> {
  return Effect.gen(function* () {
    const config = yield* ConfigService;
    const db = yield* DatabaseService;

    const rows = yield* db.query(`SELECT * FROM users WHERE id = '${id}'`);
    return parseUser(rows[0]);
  });
}
```

## Layers

Layers provide implementations for services. They define how dependencies are constructed and wired together.

### Creating Layers

```typescript
import { Layer, Effect } from "effect";

// Simple layer with static value
export const ConfigLive = Layer.succeed(ConfigService, {
  apiUrl: "https://api.example.com",
  timeout: 5000,
});

// Layer with effectful construction
export const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const config = yield* ConfigService; // Can depend on other services
    const connection = yield* connectToDatabase(config.dbUrl);

    return {
      query: (sql: string) => executeQuery(connection, sql),
      connection,
    };
  }),
);
```

### Layer Composition

Compose layers using `Layer.provide` and `Layer.provideMerge`:

```typescript
import { Layer } from "effect";

// Layer that depends on ConfigService
export const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    // ... implementation
  }),
);

// Combine layers - DatabaseService now has ConfigService available
export const AppLive = DatabaseLive.pipe(
  Layer.provide(ConfigLive), // Provide ConfigService to DatabaseService
);

// Merge multiple independent layers
export const AllServicesLive = Layer.merge(
  ConfigLive,
  LoggerLive,
  CacheLive,
);

// ProvideMerge - merge dependency layer with current layer
export const FullStackLive = DatabaseLive.pipe(
  Layer.provideMerge(ConfigLive), // Both DatabaseService AND ConfigService available
  Layer.provide(Logger.pretty),   // Add logging
);
```

### Layer Patterns

```typescript
// Platform-specific layers (Bun, Node, Browser)
import { BunContext } from "@effect/platform-bun";

export const WebLive = HonoWebServiceLive.pipe(
  Layer.provideMerge(FpDirLive),
  Layer.provide(BunContext.layer), // Provides FileSystem, CommandExecutor, etc.
  Layer.provide(Logger.pretty),
);

// Conditional logging levels
const FP_DEBUG = process.env.FP_DEBUG === "true";

export const ReviewLive = HonoReviewServiceLive.pipe(
  Layer.provideMerge(ReviewSubmitServiceLive),
  Layer.provideMerge(FpDirLive),
  Layer.provide(BunContext.layer),
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(FP_DEBUG ? LogLevel.Debug : LogLevel.Info)),
);
```

## Error Handling

### Tagged Errors

Use `Data.TaggedError` for typed error handling:

```typescript
import { Data } from "effect";

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly path: string;
  readonly suggestion?: string;
}> {
  get message(): string {
    const base = `File not found: ${this.path}`;
    return this.suggestion ? `${base}\n  Suggestion: ${this.suggestion}` : base;
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly reason: string;
}> {
  get message(): string {
    return `Invalid ${this.field}: ${this.reason}`;
  }
}
```

### Error Union Types

Create union types for all errors in a domain:

```typescript
export type AppError =
  | FileNotFoundError
  | ValidationError
  | DatabaseError
  | NetworkError;
```

### Handling Errors

```typescript
import { Effect } from "effect";

// Return errors with Effect.fail
export function readConfig(path: string): Effect.Effect<Config, FileNotFoundError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path);

    if (!exists) {
      return yield* Effect.fail(
        new FileNotFoundError({
          path,
          suggestion: "Run 'init' to create default config",
        }),
      );
    }

    const content = yield* fs.readFileString(path);
    return parseConfig(content);
  });
}

// Catch and transform errors
const result = pipe(
  readConfig("config.json"),
  Effect.catchTag("FileNotFoundError", (error) =>
    Effect.succeed(defaultConfig), // Provide fallback
  ),
);

// Catch all errors
const safe = pipe(
  dangerousOperation(),
  Effect.catchAll((error) => Effect.succeed(fallbackValue)),
);
```

## Pipe and Composition

Use `pipe` for function composition and transformations:

```typescript
import { pipe, Effect } from "effect";

// Transform effect results
const result = pipe(
  fetchData(),
  Effect.map((data) => data.toUpperCase()),
  Effect.tap((data) => Effect.log(`Got: ${data}`)), // Side effect, doesn't change value
  Effect.flatMap((data) => saveData(data)), // Chain another effect
);

// Provide dependencies
const executed = pipe(
  myEffect,
  Effect.provide(MyServiceLive),
);

// Multiple transformations
const processed = pipe(
  Effect.succeed([1, 2, 3]),
  Effect.map((arr) => arr.map((x) => x * 2)),
  Effect.flatMap((arr) => Effect.forEach(arr, (x) => processItem(x))),
  Effect.tap(() => Effect.log("Processing complete")),
);
```

### Common Pipe Operators

```typescript
// Effect.map - transform success value
Effect.map((value) => transform(value))

// Effect.flatMap - chain effects (also called andThen)
Effect.flatMap((value) => nextEffect(value))

// Effect.tap - side effect without changing value
Effect.tap((value) => Effect.log(`Value: ${value}`))

// Effect.catchTag - handle specific error
Effect.catchTag("ErrorName", (error) => Effect.succeed(fallback))

// Effect.catchAll - handle any error
Effect.catchAll((error) => Effect.succeed(fallback))

// Effect.provide - provide layer/service
Effect.provide(MyLayer)

// Effect.asVoid - discard result
Effect.asVoid
```

## Resource Management

Use `Effect.acquireRelease` for resources that need cleanup:

```typescript
import { Effect } from "effect";

export function withServer(port: number): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      // Acquire resource with cleanup
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port,
            fetch: app.fetch,
          })
        ),
        (server) => Effect.sync(() => server.stop()), // Cleanup runs on scope exit
      );

      yield* Effect.log(`Server started on port ${server.port}`);

      // Block forever - cleanup still runs on interrupt (Ctrl+C)
      return yield* Effect.never;
    }),
  );
}
```

### Scoped Pattern

- Wrap resource effects with `Effect.scoped`
- Use `Effect.acquireRelease(acquire, release)` for resources
- Release runs on scope exit (normal, error, or interrupt)
- Perfect for servers, file handles, database connections

## Advanced Patterns

### Option Integration

```typescript
import { Option, Effect } from "effect";

function findUser(id: string): Effect.Effect<Option.Option<User>, Error, Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db.query(`SELECT * FROM users WHERE id = '${id}'`);

    if (rows.length === 0) {
      return Option.none();
    }

    return Option.some(parseUser(rows[0]));
  });
}

// Work with Option results
const result = pipe(
  findUser("123"),
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.fail(new UserNotFoundError({ id: "123" })),
      onSome: (user) => Effect.succeed(user),
    }),
  ),
);

// Check Option values
if (Option.isSome(maybeValue)) {
  const value = maybeValue.value; // Type-safe access
}

if (Option.isNone(maybeValue)) {
  // Handle missing value
}
```

### Schema Validation

```typescript
import { Schema, Effect, Option } from "effect";

const UserSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  age: Schema.Number,
  email: Schema.optional(Schema.String),
});

// Decode with Option (returns None on error)
const maybeUser = Schema.decodeUnknownOption(UserSchema)(data);

// Decode with Effect (fails with error details)
const user = yield* Schema.decodeUnknown(UserSchema)(data);

// Encode back to unknown
const encoded = Schema.encode(UserSchema)(user);
```

### Match Pattern (Tagged Unions)

```typescript
import { Data, Match } from "effect";

type Result = Data.TaggedEnum<{
  Single: { readonly value: string };
  Multiple: { readonly values: readonly string[] };
  Empty: {};
}>;

const { Single, Multiple, Empty, $is } = Data.taggedEnum<Result>();

// Pattern match with Match.value
const formatted = Match.value(result).pipe(
  Match.tag("Single", (r) => `Found: ${r.value}`),
  Match.tag("Multiple", (r) => `Found ${r.values.length} items`),
  Match.tag("Empty", () => "Nothing found"),
  Match.exhaustive, // Ensures all cases handled
);

// Type guard with $is
if ($is("Single")(result)) {
  console.log(result.value); // Type narrowed to Single
}
```

### Deferred (Promises-like)

```typescript
import { Deferred, Effect } from "effect";

export function waitForSubmit(): Effect.Effect<Data, never, SubmitService> {
  return Effect.gen(function* () {
    const { submitDeferred } = yield* SubmitService;

    // Wait for deferred to complete (like Promise.resolve)
    const data = yield* Deferred.await(submitDeferred);

    return data;
  });
}

// Create and complete deferred
const layer = Layer.effect(
  SubmitService,
  Effect.gen(function* () {
    const submitDeferred = yield* Deferred.make<Data, never>();
    return { submitDeferred };
  }),
);

// Complete from elsewhere
yield* Deferred.succeed(submitDeferred, data);
yield* Deferred.fail(submitDeferred, error);
```

## Platform Integrations

### File System

```typescript
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";

export function readConfig(): Effect.Effect<Config, Error, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists("/path/to/config.json");
    const content = yield* fs.readFileString("/path/to/config.json");
    const dirs = yield* fs.readDirectory("/path/to/dir");

    yield* fs.writeFileString("/output.txt", "data");
    yield* fs.makeDirectory("/new/dir");

    return parseConfig(content);
  });
}
```

### Command Execution

```typescript
import * as Command from "@effect/platform/Command";
import { Effect, pipe } from "effect";

export function openBrowser(url: string): Effect.Effect<void, PlatformError, CommandExecutor> {
  return pipe(
    Command.make("open", url), // Create command
    Command.start,              // Start execution
    Effect.asVoid,              // Discard result
  );
}

export function runGit(args: string[]): Effect.Effect<string, Error, CommandExecutor> {
  return pipe(
    Command.make("git", ...args),
    Command.stdout("string"),
  );
}
```

### Logging

```typescript
import { Effect, Logger, LogLevel } from "effect";

// In effect code
yield* Effect.log("Starting process");
yield* Effect.logDebug("Debug info");
yield* Effect.logError("Error occurred");

// Configure logger in layer
export const AppLive = MyServiceLive.pipe(
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
);
```

## Running Effects

### In Node/Bun Applications

```typescript
import { Effect } from "effect";
import { BunContext } from "@effect/platform-bun";

// Run effect with runtime
const program = Effect.gen(function* () {
  const result = yield* myEffect();
  return result;
}).pipe(
  Effect.provide(MyServiceLive),
  Effect.provide(BunContext.layer),
);

// Execute (returns Promise)
Effect.runPromise(program).then(console.log).catch(console.error);

// Top-level await
const result = await Effect.runPromise(program);
```

### In Tauri Commands

Tauri commands must return Promises. Convert Effects to Promises:

```typescript
import { Effect } from "effect";

#[tauri::command]
async fn my_command(data: String) -> Result<Response, String> {
  const effect = Effect.gen(function* () {
    const service = yield* MyService;
    const result = yield* service.process(data);
    return result;
  }).pipe(
    Effect.provide(MyServiceLive),
  );

  // Convert to Promise for Tauri
  try {
    const result = await Effect.runPromise(effect);
    Ok(result)
  } catch (error) {
    Err(error.message)
  }
}
```

## Best Practices

### Do's

1. Use `Effect.gen` for sequential composition
2. Define services with `Context.Tag`
3. Use tagged errors for domain errors
4. Compose layers for dependency injection
5. Use `pipe` for transformations
6. Use `Effect.acquireRelease` for resources
7. Keep services focused and single-purpose
8. Use `readonly` in service definitions
9. Leverage type inference (avoid explicit types when possible)

### Don'ts

1. Don't use `yield` without `*` (must be `yield*`)
2. Don't mix Promise/async-await with Effect (convert at boundaries)
3. Don't throw exceptions (use `Effect.fail`)
4. Don't use `any` or `unknown` in service types
5. Don't create circular service dependencies
6. Don't put business logic in layers (only construction)

### Common Patterns

```typescript
// Sequential operations
const result = yield* fetchData();
const processed = transform(result);
yield* saveData(processed);

// Parallel operations
const [users, posts] = yield* Effect.all([fetchUsers(), fetchPosts()]);

// Conditional effects
const data = condition
  ? yield* fetchFromApi()
  : yield* fetchFromCache();

// Retry with backoff
const result = yield* pipe(
  unreliableOperation(),
  Effect.retry(Schedule.exponential("100 millis")),
);

// Timeout
const result = yield* pipe(
  slowOperation(),
  Effect.timeout("5 seconds"),
);
```

## Common Dependencies

```json
{
  "dependencies": {
    "effect": "^3.x.x",
    "@effect/platform": "^0.x.x",
    "@effect/platform-node": "^0.x.x",
    "@effect/platform-bun": "^0.x.x",
    "@effect/schema": "^0.x.x"
  }
}
```

## Resources

- Official docs: https://effect.website
- API reference: https://effect-ts.github.io/effect
- Discord: https://discord.gg/effect-ts
- Examples: https://github.com/Effect-TS/effect/tree/main/packages/effect/examples
