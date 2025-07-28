# Memory Debugging Script for Dart-Code Tests
# This script helps identify which test bot is consuming excessive memory

param(
    [switch]$Verbose,
    [switch]$EnableGC,
    [int]$MaxMemoryMB = 8192
)

Write-Host "🔍 Starting Memory Debugging for Dart-Code Tests" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

# Function to get current memory usage
function Get-MemoryUsage {
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($processes) {
        $totalMemory = ($processes | Measure-Object WorkingSet64 -Sum).Sum / 1MB
        return [math]::Round($totalMemory, 2)
    }
    return 0
}

# Function to run test with memory monitoring
function Test-WithMemoryMonitoring {
    param([string]$BotName)

    Write-Host "`n🤖 Testing BOT: $BotName" -ForegroundColor Yellow
    Write-Host "========================" -ForegroundColor Yellow

    # Set environment variable
    $env:BOT = $BotName

    # Get baseline memory
    $baselineMemory = Get-MemoryUsage
    Write-Host "📊 Baseline memory usage: $baselineMemory MB"

    # Start time tracking
    $startTime = Get-Date

    # Run the test
    if ($EnableGC) {
        Write-Host "🗑️  Running with garbage collection enabled..."
        $testCommand = "node --expose-gc --max-old-space-size=$MaxMemoryMB ./out/src/test/test_all.js"
    } else {
        $testCommand = "npm run test"
    }

    try {
        if ($Verbose) {
            Write-Host "🚀 Command: $testCommand"
        }

        $process = Start-Process -FilePath "cmd" -ArgumentList "/c", $testCommand -PassThru -Wait
        $endTime = Get-Date
        $duration = $endTime - $startTime

        # Get peak memory
        $peakMemory = Get-MemoryUsage
        $memoryIncrease = $peakMemory - $baselineMemory

        # Results
        Write-Host "✅ Test completed in $($duration.TotalMinutes.ToString('F2')) minutes" -ForegroundColor Green
        Write-Host "📈 Peak memory usage: $peakMemory MB (increase: +$memoryIncrease MB)" -ForegroundColor $(if ($memoryIncrease -gt 500) { "Red" } elseif ($memoryIncrease -gt 200) { "Yellow" } else { "Green" })
        Write-Host "🏁 Exit code: $($process.ExitCode)" -ForegroundColor $(if ($process.ExitCode -eq 0) { "Green" } else { "Red" })

        if ($process.ExitCode -ne 0) {
            Write-Host "❌ Test failed! This might be related to memory issues." -ForegroundColor Red
        }

        return @{
            Bot = $BotName
            Duration = $duration.TotalMinutes
            MemoryIncrease = $memoryIncrease
            ExitCode = $process.ExitCode
            Success = $process.ExitCode -eq 0
        }
    }
    catch {
        Write-Host "💥 Error running test: $($_.Exception.Message)" -ForegroundColor Red
        return @{
            Bot = $BotName
            Duration = 0
            MemoryIncrease = 0
            ExitCode = -1
            Success = $false
            Error = $_.Exception.Message
        }
    }
    finally {
        # Clean up environment
        Remove-Item Env:BOT -ErrorAction SilentlyContinue
    }
}

# Main execution
try {
    # Ensure the project is built
    Write-Host "🔨 Building project..." -ForegroundColor Blue
    npm run build
    npm run build-tests

    # Test Flutter bot (where memory issues occur)
    $results = @()
    $result = Test-WithMemoryMonitoring -BotName "flutter"
    $results += $result

    # Summary
    Write-Host "`n📋 SUMMARY" -ForegroundColor Cyan
    Write-Host "==========" -ForegroundColor Cyan

    foreach ($result in $results) {
        $status = if ($result.Success) { "✅ PASS" } else { "❌ FAIL" }
        $memoryFlag = if ($result.MemoryIncrease -gt 500) { "🚨 HIGH MEMORY" } elseif ($result.MemoryIncrease -gt 200) { "⚠️  MEDIUM MEMORY" } else { "✅ LOW MEMORY" }

        Write-Host "$($result.Bot): $status | $memoryFlag | $($result.Duration.ToString('F2'))min | +$($result.MemoryIncrease)MB"

        if ($result.Error) {
            Write-Host "   Error: $($result.Error)" -ForegroundColor Red
        }
    }

    # Recommendations
    $result = $results[0]  # Only Flutter bot result
    if ($result.MemoryIncrease -gt 200 -or -not $result.Success) {
        Write-Host "`n🎯 FLUTTER BOT ANALYSIS" -ForegroundColor Magenta
        Write-Host "=======================" -ForegroundColor Magenta

        if (-not $result.Success) {
            Write-Host "❌ Flutter tests failed (exit code: $($result.ExitCode))" -ForegroundColor Red
            if ($result.Error) {
                Write-Host "Error: $($result.Error)" -ForegroundColor Red
            }
        }

        if ($result.MemoryIncrease -gt 200) {
            Write-Host "🚨 High memory usage detected: +$($result.MemoryIncrease)MB" -ForegroundColor Red
        }

        Write-Host ""
        Write-Host "Focus your investigation on Flutter tests in: src/test/flutter/**"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "1. Add memory tracking to individual Flutter test files"
        Write-Host "2. Run specific Flutter test categories with: `$env:BOT='flutter'; npm run test"
        Write-Host "3. Check for leaked resources in Flutter-specific areas:"
        Write-Host "   - Flutter daemon connections"
        Write-Host "   - Device watchers"
        Write-Host "   - Flutter processes not properly terminated"
        Write-Host "   - LSP connections to Flutter analyzer"
    } else {
        Write-Host "`n✅ Flutter tests completed successfully with reasonable memory usage" -ForegroundColor Green
    }
}
catch {
    Write-Host "💥 Script failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n🏁 Memory debugging complete!" -ForegroundColor Green
