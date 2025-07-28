# Simple one-liner version
# Usage: .\simple-monitor.ps1

try {
    while ($true) {
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        "[$timestamp] VS Code Status:" | Out-File -FilePath "vscode-status.txt" -Append -Encoding UTF8
        code --status | Out-File -FilePath "vscode-status.txt" -Append -Encoding UTF8
        "" | Out-File -FilePath "vscode-status.txt" -Append -Encoding UTF8
        Write-Host "Status logged at $timestamp"
        Start-Sleep 1
    }
} catch {
    Write-Host "Monitoring stopped"
}
