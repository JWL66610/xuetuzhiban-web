Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(960, 360)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = New-Object System.Drawing.Font('Arial', 26)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.DrawString('Question 1: Find the derivative of f(x) = x^2.', $font, [System.Drawing.Brushes]::Black, 25, 55)
$graphics.DrawString('Question 2: Calculate 7 + 8.', $font, [System.Drawing.Brushes]::Black, 25, 150)
$bitmap.Save((Join-Path $PSScriptRoot '../test/fixtures/upload-question.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$font.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
