$Version = "12.2.2"
$TargetBase = "app\target"
$TempDir = "tmp_mariadb_prepare"

$Configs = @(
    @{
        Arch = "x86_64";
        Url = "https://dlm.mariadb.com/4583633/MariaDB/mariadb-12.2.2/repo/debian/mariadb-12.2.2-debian-bookworm-amd64-debs.tar";
        Tarball = "mariadb-12.2.2-amd64-debs.tar"
    },
    @{
        Arch = "aarch64";
        Url = "https://dlm.mariadb.com/4583634/MariaDB/mariadb-12.2.2/repo/debian/mariadb-12.2.2-debian-bookworm-arm64-debs.tar";
        Tarball = "mariadb-12.2.2-arm64-debs.tar"
    }
)

Write-Host "=== MariaDB $Version Preparation Tool (Optimized) ===" -ForegroundColor Cyan

if (-not (Test-Path $TempDir)) { New-Item -ItemType Directory -Path $TempDir -Force | Out-Null }

foreach ($cfg in $Configs) {
    $Arch = $cfg.Arch
    $Url = $cfg.Url
    $Tarball = $cfg.Tarball
    $ArchDir = Join-Path $TargetBase $Arch
    $ArchTemp = Join-Path $TempDir $Arch

    Write-Host "`n--- Processing Architecture: $Arch ---" -ForegroundColor Yellow
    
    if (Test-Path $ArchDir) { Remove-Item $ArchDir -Recurse -Force }
    New-Item -ItemType Directory -Path $ArchDir -Force | Out-Null
    if (Test-Path $ArchTemp) { Remove-Item $ArchTemp -Recurse -Force }
    New-Item -ItemType Directory -Path $ArchTemp -Force | Out-Null

    $TarPath = Join-Path $TempDir $Tarball
    if (-not (Test-Path $TarPath)) {
        Write-Host "Downloading $Tarball..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $Url -OutFile $TarPath
    } else {
        Write-Host "Using existing $Tarball." -ForegroundColor Gray
    }

    Write-Host "Extracting $Tarball..." -ForegroundColor Gray
    tar -xf $TarPath -C $ArchTemp

    $PackagePrefixes = @("mariadb-server-core", "mariadb-client-core", "mariadb-common", "libmariadb3", "mariadb-server_", "mariadb-client_")
    
    $DebFiles = Get-ChildItem -Path $ArchTemp -Filter "*.deb" -Recurse
    foreach ($deb in $DebFiles) {
        $matched = $false
        foreach ($prefix in $PackagePrefixes) {
            if ($deb.Name.StartsWith($prefix)) {
                $matched = $true
                break
            }
        }

        if ($matched) {
            Write-Host "Extracting $($deb.Name)..." -ForegroundColor Blue
            $DebExtractDir = Join-Path $ArchTemp $deb.BaseName
            if (-not (Test-Path $DebExtractDir)) { New-Item -ItemType Directory -Path $DebExtractDir -Force | Out-Null }
            
            tar -xf $deb.FullName -C $DebExtractDir
            
            $DataTar = Get-ChildItem -Path $DebExtractDir -Filter "data.tar*" | Select-Object -First 1
            if ($null -ne $DataTar) {
                tar -xf $DataTar.FullName -C $ArchDir
            }
        }
    }

    # CRITICAL: Clean up broken symlinks (zero-byte files) to avoid permission errors
    Write-Host "Cleaning up broken symlinks and unnecessary files..." -ForegroundColor Yellow
    $ZeroFiles = Get-ChildItem -Path $ArchDir -Recurse | Where-Object { $_.Length -eq 0 -and -not $_.PSIsContainer }
    if ($ZeroFiles) {
        Write-Host "  Removing $($ZeroFiles.Count) zero-byte files..." -ForegroundColor Gray
        $ZeroFiles | Remove-Item -Force
    }

    # Clean up documentation, man pages, etc. to reduce package size and complexity
    $DocDirs = @("usr/share/doc", "usr/share/man", "usr/share/mysql/test")
    foreach ($dir in $DocDirs) {
        $path = Join-Path $ArchDir $dir
        if (Test-Path $path) {
            Write-Host "  Removing documentation: $dir" -ForegroundColor Gray
            Remove-Item $path -Recurse -Force
        }
    }

    $TargetCount = (Get-ChildItem -Path $ArchDir -Recurse).Count
    Write-Host "Architecture $Arch Done. (Files in target: $TargetCount)" -ForegroundColor Green
}

Write-Host "`nCleaning up temporary files..." -ForegroundColor Gray
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }

Write-Host "`n=== All platforms prepared and optimized! ===" -ForegroundColor Green
Write-Host "You can now run pack.bat." -ForegroundColor Cyan
