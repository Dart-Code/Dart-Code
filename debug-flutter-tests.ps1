# Flutter Test Memory Debugger
# This script helps identify which specific Flutter test file is consuming memory

param(
    [string]$TestPattern = "src/test/flutter/**/*.test.ts",
    [switch]$EnableGC,
    [int]$MaxMemoryMB = 8192
)

Write-Host "🔍 Flutter Test Memory Analysis" -ForegroundColor Green
Write-Host "===============================" -ForegroundColor Green

# Set Flutter bot
$env:BOT = "flutter"

# Function to get memory usage
function Get-MemoryUsage {
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($processes) {
        $totalMemory = ($processes | Measure-Object WorkingSet64 -Sum).Sum / 1MB
        return [math]::Round($totalMemory, 2)
    }
    return 0
}

# Get all Flutter test files
$testFiles = Get-ChildItem -Path "src/test/flutter" -Filter "*.test.ts" -Recurse | Sort-Object Name

if ($testFiles.Count -eq 0) {
    Write-Host "❌ No Flutter test files found!" -ForegroundColor Red
    exit 1
}

Write-Host "📁 Found $($testFiles.Count) Flutter test files" -ForegroundColor Blue

# Test each file individually
$results = @()
$baselineMemory = Get-MemoryUsage()

foreach ($testFile in $testFiles) {
    $relativePath = $testFile.FullName.Replace((Get-Location).Path + "\", "")
    Write-Host "`n🧪 Testing: $relativePath" -ForegroundColor Yellow

    $startMemory = Get-MemoryUsage()
    $startTime = Get-Date

    try {
        # Run individual test file
        if ($EnableGC) {
            $testCommand = "node --expose-gc --max-old-space-size=$MaxMemoryMB ./out/$($relativePath.Replace('.ts', '.js').Replace('\', '/'))"
        } else {
            # Note: This assumes the test can be run individually
            # You might need to adjust this based on your test framework
            $testCommand = "npm run test `"$relativePath`""
        }

        $process = Start-Process -FilePath "cmd" -ArgumentList "/c", $testCommand -PassThru -Wait -WindowStyle Hidden

        $endTime = Get-Date
        $endMemory = Get-MemoryUsage()
        $duration = ($endTime - $startTime).TotalSeconds
        $memoryIncrease = $endMemory - $startMemory

        $result = @{
            File = $relativePath
            Duration = $duration
            MemoryIncrease = $memoryIncrease
            ExitCode = $process.ExitCode
            Success = $process.ExitCode -eq 0
        }

        $results += $result

        # Color code based on memory usage and success
        $statusColor = if ($result.Success) { "Green" } else { "Red" }
        $memoryColor = if ($memoryIncrease -gt 100) { "Red" } elseif ($memoryIncrease -gt 50) { "Yellow" } else { "Green" }

        Write-Host "   Status: $(if ($result.Success) { "✅ PASS" } else { "❌ FAIL" })" -ForegroundColor $statusColor
        Write-Host "   Duration: $($duration.ToString('F1'))s" -ForegroundColor White
        Write-Host "   Memory: +$($memoryIncrease.ToString('F1'))MB" -ForegroundColor $memoryColor

        # Force cleanup
        [System.GC]::Collect()
        Start-Sleep -Milliseconds 500
    }
    catch {
        Write-Host "   💥 Error: $($_.Exception.Message)" -ForegroundColor Red
        $results += @{
            File = $relativePath
            Duration = 0
            MemoryIncrease = 0
            ExitCode = -1
            Success = $false
            Error = $_.Exception.Message
        }
    }
}

# Analysis
Write-Host "`n📊 ANALYSIS" -ForegroundColor Cyan
Write-Host "===========" -ForegroundColor Cyan

# Sort by memory usage
$sortedByMemory = $results | Sort-Object MemoryIncrease -Descending

Write-Host "`n🔥 TOP MEMORY CONSUMERS:" -ForegroundColor Red
$topMemoryUsers = $sortedByMemory | Select-Object -First 5
foreach ($result in $topMemoryUsers) {
    $statusIcon = if ($result.Success) { "✅" } else { "❌" }
    Write-Host "   $statusIcon $($result.File): +$($result.MemoryIncrease.ToString('F1'))MB ($($result.Duration.ToString('F1'))s)"
}

# Failed tests
$failedTests = $results | Where-Object { -not $_.Success }
if ($failedTests.Count -gt 0) {
    Write-Host "`n❌ FAILED TESTS:" -ForegroundColor Red
    foreach ($result in $failedTests) {
        Write-Host "   $($result.File): Exit code $($result.ExitCode)"
        if ($result.Error) {
            Write-Host "      Error: $($result.Error)"
        }
    }
}

# Summary statistics
$totalMemoryIncrease = ($results | Measure-Object MemoryIncrease -Sum).Sum
$averageMemory = ($results | Measure-Object MemoryIncrease -Average).Average
$maxMemory = ($results | Measure-Object MemoryIncrease -Maximum).Maximum

Write-Host "`n📈 MEMORY STATISTICS:" -ForegroundColor Blue
Write-Host "   Total memory increase: $($totalMemoryIncrease.ToString('F1'))MB"
Write-Host "   Average per test: $($averageMemory.ToString('F1'))MB"
Write-Host "   Maximum single test: $($maxMemory.ToString('F1'))MB"

# Recommendations
$highMemoryTest = $sortedByMemory | Select-Object -First 1
if ($highMemoryTest.MemoryIncrease -gt 50) {
    Write-Host "`n🎯 RECOMMENDATION:" -ForegroundColor Magenta
    Write-Host "   Focus on: $($highMemoryTest.File)"
    Write-Host "   This test consumed +$($highMemoryTest.MemoryIncrease.ToString('F1'))MB"
    Write-Host "   Add detailed memory tracking to this specific test file."
}

# Clean up
Remove-Item Env:BOT -ErrorAction SilentlyContinue

Write-Host "`n🏁 Analysis complete!" -ForegroundColor Green
