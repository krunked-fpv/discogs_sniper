$TaskName          = "DiscogsSniper"
$ProjectDir        = "C:\discogs_sniper"
$LegacyDir         = "C:\DiscogsSniper"
$CollectionDir     = "C:\Discogs_collection"
$ScriptPath        = Join-Path $ProjectDir "discogs_sniper.py"
$EnvPath           = Join-Path $ProjectDir ".env"
$CollectionEnvPath = Join-Path $CollectionDir ".env"
$LegacyEnvPath     = Join-Path $LegacyDir ".env"

# 1. Discover DISCOGS_TOKEN from C:\Discogs_collection\.env, Windows Environment Variables, or legacy C:\DiscogsSniper\.env
$ResolvedToken = ""
foreach ($CandidateEnv in @($CollectionEnvPath, $LegacyEnvPath)) {
    if ((-not $ResolvedToken) -and (Test-Path $CandidateEnv)) {
        $EnvText = Get-Content $CandidateEnv -Raw
        if ($EnvText -match "(?m)^DISCOGS_TOKEN\s*=\s*[`"']?([A-Za-z0-9._\-]{20,})[`"']?") {
            $ResolvedToken = $Matches[1].Trim()
            Write-Host "Loaded DISCOGS_TOKEN from $CandidateEnv" -ForegroundColor Cyan
        }
    }
}

if (-not $ResolvedToken -and $env:DISCOGS_TOKEN -and ($env:DISCOGS_TOKEN -notmatch "^\`$env:")) {
    $ResolvedToken = $env:DISCOGS_TOKEN.Trim()
}
if (-not $ResolvedToken) {
    $ResolvedToken = [Environment]::GetEnvironmentVariable("DISCOGS_TOKEN", "User")
}
if (-not $ResolvedToken) {
    $ResolvedToken = [Environment]::GetEnvironmentVariable("DISCOGS_TOKEN", "Machine")
}

# 2. Write the resolved DISCOGS_TOKEN directly into C:\discogs_sniper\.env
if ($ResolvedToken -and (Test-Path $EnvPath)) {
    $EnvContent = Get-Content $EnvPath -Raw
    if ($EnvContent -match "(?m)^DISCOGS_TOKEN\s*=") {
        $EnvContent = $EnvContent -replace "(?m)^DISCOGS_TOKEN\s*=.*$", "DISCOGS_TOKEN=$ResolvedToken"
        Set-Content -Path $EnvPath -Value $EnvContent -Encoding UTF8 -NoNewline
        Write-Host "Wrote active DISCOGS_TOKEN into $EnvPath" -ForegroundColor Green
    }
}

# 3. If migrating from C:\DiscogsSniper -> C:\discogs_sniper, copy chrome_discogs_profile if needed
$LegacyProfile = Join-Path $LegacyDir "chrome_discogs_profile"
$NewProfile    = Join-Path $ProjectDir "chrome_discogs_profile"
if ((Test-Path $LegacyProfile) -and (-not (Test-Path $NewProfile))) {
    Write-Host "Migrating authenticated chrome_discogs_profile from $LegacyDir to $ProjectDir..." -ForegroundColor Cyan
    Copy-Item -Path $LegacyProfile -Destination $NewProfile -Recurse -Force
}

# 4. Locate pythonw.exe (windowless Python) so no console flashes every 5 mins
$PythonCmd = Get-Command python -ErrorAction Stop
$PythonDir = Split-Path -Parent $PythonCmd.Source
$PythonwPath = Join-Path $PythonDir "pythonw.exe"
if (-not (Test-Path $PythonwPath)) {
    $PythonwPath = $PythonCmd.Source
}
Write-Host "Using Python executable: $PythonwPath" -ForegroundColor Cyan

# 5. Keep Chrome off-screen during background runs (avoids popup while preserving Cloudflare cookies)
if (Test-Path $ScriptPath) {
    $Content = Get-Content $ScriptPath -Raw
    if ($Content -notmatch "--window-position=") {
        $Content = $Content -replace '("--disable-blink-features=AutomationControlled",)', "`$1`r`n                `"--window-position=-32000,-32000`","
        Set-Content -Path $ScriptPath -Value $Content -Encoding UTF8
        Write-Host "Patched discogs_sniper.py to position Chrome off-screen." -ForegroundColor Green
    }
}

# 6. Define the Task Action (run pythonw.exe inside C:\discogs_sniper)
$Action = New-ScheduledTaskAction `
    -Execute $PythonwPath `
    -Argument "`"$ScriptPath`"" `
    -WorkingDirectory $ProjectDir

# 7. Define ONE clean 5-minute repeating trigger + a single non-repeating AtLogOn bootstrap
$RepeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$LogonTrigger  = New-ScheduledTaskTrigger -AtLogOn

# 8. Task Settings: allow on battery, don't overlap instances, timeout stuck runs after 3 mins
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3)

# 9. Register the Scheduled Task under your current user account
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger @($LogonTrigger, $RepeatTrigger) `
    -Settings $Settings `
    -Description "Discogs Sniper v2.0 (C:\discogs_sniper): Hybrid API + GraphQL Wantlist Check every 5 minutes (288 runs/day)." `
    -Force | Out-Null

Write-Host "`nScheduled Task '$TaskName' v2.0 registered for $ProjectDir (single 5-min clock, 288 runs/day)!" -ForegroundColor Green