<#
PowerShell helper to set Render service environment variables via Render API.
Usage:
  .\set_render_env.ps1 -ServiceId <srv-...> -Key DATABASE_URL -Value '<your_database_url>' [-WhatIf]
Authentication: the script reads the Render API key from environment variable `$env:RENDER_API_KEY`.
#>
param(
  [string]$ServiceId,
  [string]$Key = 'DATABASE_URL',
  [string]$Value,
  [switch]$WhatIf
)

if (-not $ServiceId) { Write-Error "ServiceId is required (-ServiceId)."; exit 2 }
if (-not $Value -and -not $WhatIf) { Write-Error "Value is required when not using -WhatIf."; exit 2 }

# Use API key from environment only. Never accept or print a key parameter.
if (-not $env:RENDER_API_KEY) { Write-Error "Environment variable RENDER_API_KEY is not set."; exit 2 }

$serviceIdEscaped = $ServiceId
$endpoint = "https://api.render.com/v1/services/$serviceIdEscaped/env-vars/$Key"
$method = 'PUT'

function MaskSecret($val) {
  if (-not $val) { return "<empty>" }
  return '***MASKED***'
}

if ($WhatIf) {
  Write-Host "DRY-RUN (-WhatIf) summary:" -ForegroundColor Yellow
  Write-Host "  Service ID: $ServiceId"
  Write-Host "  Variable:   $Key"
  Write-Host "  Endpoint:   $endpoint"
  Write-Host "  Method:     $method"
  $masked = MaskSecret $Value
  $bodyPreview = @{ value = $masked } | ConvertTo-Json
  Write-Host "  Request body (masked):`n$bodyPreview"
  Write-Host "NOTE: API key will be read from environment variable RENDER_API_KEY at execution time (not shown)."
  exit 0
}

# Build request (single-variable update)
$headers = @{ Authorization = "Bearer $env:RENDER_API_KEY"; 'Content-Type' = 'application/json' }
$body = @{ value = $Value } | ConvertTo-Json

try {
  Write-Host "Updating service env var..." -ForegroundColor Cyan
  $resp = Invoke-RestMethod -Uri $endpoint -Method Put -Headers $headers -Body $body -ErrorAction Stop
  Write-Host "SUCCESS: Updated $Key on service $ServiceId" -ForegroundColor Green
  exit 0
} catch {
  Write-Error "ERROR: $($_.Exception.Message)"
  if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ }
  exit 1
}
