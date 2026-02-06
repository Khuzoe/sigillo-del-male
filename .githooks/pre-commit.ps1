Write-Host "[pre-commit] Running QA checks..."
npm.cmd run qa
if ($LASTEXITCODE -ne 0) {
  Write-Host "[pre-commit] QA failed. Commit aborted."
  exit $LASTEXITCODE
}
Write-Host "[pre-commit] QA passed."
exit 0
