# Build Script (PowerShell)
$env:GOOS="linux"
$env:GOARCH="amd64"
$env:CGO_ENABLED="0"
$env:GOPROXY="https://goproxy.cn,direct"

Write-Host "Tidying go modules..." -ForegroundColor Cyan
go mod tidy

Write-Host "Building appcenter (Linux amd64)..." -ForegroundColor Cyan
go build -v -ldflags="-s -w" -o appcenter

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build Success! Output: appcenter" -ForegroundColor Green
} else {
    Write-Host "Build failed. Please check the error messages above." -ForegroundColor Red
}
