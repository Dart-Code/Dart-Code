# Memory Debugging Guide for Dart-Code Tests

This guide provides several approaches to track down memory leaks in your test suite.

## 1. Quick Memory Monitoring (Easiest)

Add this to your test files that you suspect are problematic:

```typescript
import { globalMemoryTracker } from "../shared/memory_tracker";

describe("Your Test Suite", () => {
    beforeEach(() => {
        globalMemoryTracker.setBaseline();
    });

    afterEach(() => {
        globalMemoryTracker.checkForMemoryLeaks("After test");
        globalMemoryTracker.forceGarbageCollection();
    });

    it("your test", () => {
        // Your test code
        globalMemoryTracker.logCurrentUsage("During test");
    });
});
```

## 2. Run Tests with Memory Monitoring

Run your tests with these flags to get better memory debugging:

```powershell
# Set the BOT environment variable for specific test suites
$env:BOT="flutter"  # or "dart"
npm run test

# Enable garbage collection and increase memory limit (modify package.json test script)
# Change "test": "node ./out/src/test/test_all.js"
# To:     "test": "node --expose-gc --max-old-space-size=8192 ./out/src/test/test_all.js"
```

## 3. Identify Memory-Heavy Tests

Create a script to run tests individually and measure memory:

```powershell
# PowerShell script to test individual bots
$bots = @("dart", "flutter")
foreach ($bot in $bots) {
    Write-Host "Testing BOT: $bot"
    $env:BOT = $bot
    $startTime = Get-Date
    $process = Start-Process -FilePath "npm" -ArgumentList "run", "test" -PassThru -Wait
    $endTime = Get-Date
    $duration = $endTime - $startTime
    Write-Host "BOT $bot completed in $($duration.TotalMinutes) minutes with exit code $($process.ExitCode)"
    Write-Host "Peak memory usage: $([math]::Round($process.PeakWorkingSet64 / 1MB, 2)) MB"
    Write-Host "---"
}
```

## 4. Node.js Memory Profiling

Use Node.js built-in profiling:

```bash
# Generate heap snapshots
npm run test -- --inspect-brk=0.0.0.0:9229 your-test-pattern

# Then connect Chrome DevTools to analyze memory
```

## 5. Suspect Areas to Check

Based on common VS Code extension patterns, check these areas:

1. **LSP Client/Server connections** - May not be properly disposed
2. **File watchers** - Often leak if not disposed
3. **Event listeners** - Accumulate if not removed
4. **Large arrays/buffers** - Test data that grows over time
5. **Dart/Flutter processes** - Child processes not properly killed

## 6. Test Isolation

Run tests in isolation to find the culprit:

```powershell
# Run specific test categories
$env:BOT="dart"
npm run test

$env:BOT="flutter" 
npm run test

# Clear environment variable
Remove-Item Env:BOT
```

## 7. Memory-Safe Test Patterns

Ensure your tests follow these patterns:

```typescript
describe("Test Suite", () => {
    let disposables: IAmDisposable[] = [];

    afterEach(() => {
        // Dispose all resources
        disposables.forEach(d => d.dispose());
        disposables = [];
    });

    it("test with resources", () => {
        const resource = createSomeResource();
        disposables.push(resource);
        // test code
    });
});
```
