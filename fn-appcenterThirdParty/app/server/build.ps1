# Build Script (PowerShell)
$ARCH = $args[0] -or "x86_64"
switch ($ARCH) {
    "x86_64" { $GOARCH = "amd64" }
    "aarch64" { $GOARCH = "arm64" }
}
$env:GOOS="linux"
$env:GOARCH=$GOARCH
$env:CGO_ENABLED="0"
$env:GOPROXY="https://goproxy.cn,direct"

Write-Host "Tidying go modules..." -ForegroundColor Cyan
go mod tidy

Write-Host "Building appcenter (Linux $ARCH)..." -ForegroundColor Cyan
go build -v -ldflags="-s -w" -o appcenter_$ARCH

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build Success! Output: appcenter_$ARCH" -ForegroundColor Green
} else {
    Write-Host "Build failed. Please check the error messages above." -ForegroundColor Red
}
