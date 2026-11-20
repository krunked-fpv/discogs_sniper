# 1. Automatically locate the unzipped folder containing index.html
$IndexFile = Get-ChildItem -Path "C:\Users\alexg\Downloads\discogs_collection" -Filter "index.html" -Recurse | Select-Object -First 1
if (-not $IndexFile) { Write-Error "Could not find index.html inside C:\Users\alexg\Downloads\discogs_collection"; return }
$SourceDir = $IndexFile.DirectoryName
Write-Host "Found unzipped files at: $SourceDir" -ForegroundColor Cyan

# 2. Clone your live repo cleanly into a temp working directory
$WorkDir = "$env:TEMP\discogs_collection_push"
if (Test-Path $WorkDir) { Remove-Item -Path $WorkDir -Recurse -Force }
git clone "https://github.com/krunked-fpv/discogs_collection.git" $WorkDir

# 3. Copy all generated files into the cloned repo, commit, and push
Copy-Item -Path "$SourceDir\*" -Destination $WorkDir -Recurse -Force
Set-Location $WorkDir
git config user.name "krunked-fpv"
git config user.email "alexgoresch@gmail.com"
git add -A
git commit -m "feat: pressing-first Discogs collection vault and deterministic sync pipeline"
git push origin main

# 4. If GitHub CLI (gh) is installed, set DISCOGS_TOKEN from environment and enable GitHub Pages
if (Get-Command gh -ErrorAction SilentlyContinue) {
    if ($env:DISCOGS_TOKEN) {
        $env:DISCOGS_TOKEN | gh secret set DISCOGS_TOKEN --repo "krunked-fpv/discogs_collection"
    }
    gh api -X POST "repos/krunked-fpv/discogs_collection/pages" -f build_type="workflow"
    gh api -X PUT "repos/krunked-fpv/discogs_collection/pages" -f build_type="workflow"
    gh workflow run "sync-and-deploy.yml" --repo "krunked-fpv/discogs_collection"
}