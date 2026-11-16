# Aplica as migrations pendentes num projeto Supabase via Management API.
# Uso: $env:SUPABASE_ACCESS_TOKEN = "..."; ./scripts/apply-migrations.ps1 -ProjectRef <ref>
# Regista cada migration em supabase_migrations.schema_migrations (compatível com o Supabase CLI).
param([Parameter(Mandatory = $true)][string]$ProjectRef)

$ErrorActionPreference = "Stop"
if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "Defina SUPABASE_ACCESS_TOKEN" }
$headers = @{ Authorization = "Bearer $($env:SUPABASE_ACCESS_TOKEN)"; "Content-Type" = "application/json; charset=utf-8" }
$uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"

function Invoke-Sql([string]$sql) {
  $body = [System.Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3 -Compress))
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
}

Invoke-Sql @"
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
"@ | Out-Null

$applied = @((Invoke-Sql "select version from supabase_migrations.schema_migrations") | ForEach-Object { $_.version })
$dir = Join-Path $PSScriptRoot "..\supabase\migrations"
foreach ($file in Get-ChildItem $dir -Filter *.sql | Sort-Object Name) {
  $version, $name = $file.BaseName -split "_", 2
  if ($applied -contains $version) { Write-Host "= $($file.Name) (já aplicada)"; continue }
  $sql = Get-Content $file.FullName -Raw -Encoding UTF8
  $escapedName = $name -replace "'", "''"
  # Migration e registo na mesma transação: ou tudo, ou nada.
  Invoke-Sql "begin;`n$sql`ninsert into supabase_migrations.schema_migrations (version, name) values ('$version', '$escapedName');`ncommit;" | Out-Null
  Write-Host "+ $($file.Name)"
}
