Write-Host "[pre-commit] Running QA checks..."
npm.cmd run check:webp-only
if ($LASTEXITCODE -ne 0) {
  Write-Host "[pre-commit] Image format check failed. Commit aborted."
  exit $LASTEXITCODE
}

npm.cmd run qa
if ($LASTEXITCODE -ne 0) {
  Write-Host "[pre-commit] QA failed. Commit aborted."
  exit $LASTEXITCODE
}
Write-Host "[pre-commit] QA passed."
exit 0
