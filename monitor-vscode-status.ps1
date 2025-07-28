# PowerShell script to continuously monitor VS Code status
# Press Ctrl+C to stop

param(
    [string]$OutputFile = "vscode-status-monitor.txt",
    [int]$IntervalSeconds = 5
)

Write-Host "🔍 Monitoring VS Code status..." -ForegroundColor Green
Write-Host "📁 Output file: $OutputFile" -ForegroundColor Blue
Write-Host "⏱️  Interval: $IntervalSeconds seconds" -ForegroundColor Blue
Write-Host "🛑 Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "=" * 50

# Initialize the output file
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"VS Code Status Monitor Started: $timestamp" | Out-File -FilePath $OutputFile -Encoding UTF8
"=" * 60 | Out-File -FilePath $OutputFile -Append -Encoding UTF8
"" | Out-File -FilePath $OutputFile -Append -Encoding UTF8

try {
    while ($true) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

        # Add timestamp header
        "" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
        "[$timestamp] VS Code Status:" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
        "-" * 40 | Out-File -FilePath $OutputFile -Append -Encoding UTF8

        try {
            # Run code --status and capture output
            $statusOutput = & code --status 2>&1

            if ($LASTEXITCODE -eq 0) {
                $statusOutput | Out-File -FilePath $OutputFile -Append -Encoding UTF8
                Write-Host "✅ Status logged at $timestamp" -ForegroundColor Green
            } else {
                "ERROR: VS Code --status command failed with exit code $LASTEXITCODE" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
                "Output: $statusOutput" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
                Write-Host "❌ Error logged at $timestamp" -ForegroundColor Red
            }
        }
        catch {
            "ERROR: Exception occurred while running VS Code status: $($_.Exception.Message)" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
            Write-Host "💥 Exception logged at $timestamp" -ForegroundColor Red
        }

        # Wait for the specified interval
        Start-Sleep -Seconds $IntervalSeconds
    }
}
catch [System.Management.Automation.PipelineStoppedException] {
    # This happens when Ctrl+C is pressed
    Write-Host "`n🛑 Monitoring stopped by user" -ForegroundColor Yellow
}
finally {
    # Add final timestamp
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    "VS Code Status Monitor Stopped: $timestamp" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    "=" * 60 | Out-File -FilePath $OutputFile -Append -Encoding UTF8

    Write-Host "📄 Final output saved to: $OutputFile" -ForegroundColor Green
    Write-Host "📊 Monitor completed!" -ForegroundColor Green
}
