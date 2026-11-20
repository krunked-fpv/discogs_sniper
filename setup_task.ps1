$TaskName   = "DiscogsSniper"
$ProjectDir = "C:\DiscogsSniper"
$ScriptPath = Join-Path $ProjectDir "discogs_sniper.py"

# 1. Locate pythonw.exe (windowless Python) so no console flashes every 5 mins
$PythonCmd = Get-Command python -ErrorAction Stop
$PythonDir = Split-Path -Parent $PythonCmd.Source
$PythonwPath = Join-Path $PythonDir "pythonw.exe"
if (-not (Test-Path $PythonwPath)) {
    $PythonwPath = $PythonCmd.Source
}
Write-Host "Using Python executable: $PythonwPath" -ForegroundColor Cyan

# 2. Keep Chrome off-screen during background runs (avoids popup while preserving Cloudflare cookies)
if (Test-Path $ScriptPath) {
    $Content = Get-Content $ScriptPath -Raw
    if ($Content -notmatch "--window-position=") {
        $Content = $Content -replace '("--disable-blink-features=AutomationControlled",)', "`$1`r`n                `"--window-position=-32000,-32000`","
        Set-Content -Path $ScriptPath -Value $Content -Encoding UTF8
        Write-Host "Patched discogs_sniper.py to position Chrome off-screen." -ForegroundColor Green
    }
}

# 3. Define the Task Action (run pythonw.exe inside C:\DiscogsSniper)
$Action = New-ScheduledTaskAction `
    -Execute $PythonwPath `
    -Argument "`"$ScriptPath`"" `
    -WorkingDirectory $ProjectDir

# 4. Define Triggers: start immediately + at Windows Logon, repeating every 5 minutes indefinitely
$RepeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$LogonTrigger  = New-ScheduledTaskTrigger -AtLogOn
$LogonTrigger.Repetition = $RepeatTrigger.Repetition

# 5. Task Settings: allow on battery, don't overlap instances, timeout stuck runs after 3 mins
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3)

# 6. Register the Scheduled Task under your current user account
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger @($LogonTrigger, $RepeatTrigger) `
    -Settings $Settings `
    -Description "Checks Discogs Wantlist every 5 minutes in the background." `
    -Force | Out-Null

Write-Host "`nScheduled Task '$TaskName' registered and active!" -ForegroundColor Green