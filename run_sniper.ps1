$ProjectDir = "C:\discogs_sniper"
$ScriptFile = "discogs_sniper.py"
$IntervalSeconds = 300

if (-not (Test-Path $ProjectDir)) {
    $ProjectDir = $PSScriptRoot
}
Set-Location -Path $ProjectDir
Write-Host "=== Discogs Sniper v2.0 Loop Started ($ProjectDir) ===" -ForegroundColor Cyan
Write-Host "Press Ctrl + C at any time to stop.`n" -ForegroundColor Yellow

try {
    while ($true) {
        $StartTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "[$StartTime] Running Discogs check..." -ForegroundColor Green

        python $ScriptFile

        $NextRun = (Get-Date).AddSeconds($IntervalSeconds).ToString("HH:mm:ss")
        Write-Host "Check complete. Next run at $NextRun. Sleeping..." -ForegroundColor Gray
        Start-Sleep -Seconds $IntervalSeconds
    }
}
finally {
    Write-Host "`n=== Discogs Sniper Loop Stopped ===" -ForegroundColor Red
}