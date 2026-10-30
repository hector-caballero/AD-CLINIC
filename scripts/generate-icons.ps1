<#
.SYNOPSIS
    Genera los iconos PNG (192px, 512px, maskable y apple-touch-icon) de AD Clinic.

.DESCRIPTION
    Script de apoyo para regenerar los assets de `public/icons` sin depender de
    herramientas externas. Requiere Windows PowerShell 5.1+ (System.Drawing).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\generate-icons.ps1
#>

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

# Paleta de marca de AD Clinic
$gradientStart = [System.Drawing.ColorTranslator]::FromHtml('#0c4a6e') # sky-900
$gradientEnd = [System.Drawing.ColorTranslator]::FromHtml('#06b6d4')   # cyan-500
$toothColor = [System.Drawing.ColorTranslator]::FromHtml('#ffffff')

# Escala/offset usados por el helper de coordenadas del diente
$script:span = 1.0
$script:offsetX = 0.0
$script:offsetY = 0.0

function New-Point([double]$x, [double]$y) {
    New-Object System.Drawing.PointF(
        [float]($script:span * $x + $script:offsetX),
        [float]($script:span * $y + $script:offsetY)
    )
}

function New-ToothPath {
    # Trazado del diente en un lienzo lógico de 100x100
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.StartFigure()
    $path.AddBezier((New-Point 50 10), (New-Point 35 10), (New-Point 25 18), (New-Point 25 32))
    $path.AddBezier((New-Point 25 32), (New-Point 25 45), (New-Point 30 55), (New-Point 32 70))
    $path.AddBezier((New-Point 32 70), (New-Point 33 80), (New-Point 34 90), (New-Point 40 90))
    $path.AddBezier((New-Point 40 90), (New-Point 46 90), (New-Point 45 78), (New-Point 50 78))
    $path.AddBezier((New-Point 50 78), (New-Point 55 78), (New-Point 54 90), (New-Point 60 90))
    $path.AddBezier((New-Point 60 90), (New-Point 66 90), (New-Point 67 80), (New-Point 68 70))
    $path.AddBezier((New-Point 68 70), (New-Point 70 55), (New-Point 75 45), (New-Point 75 32))
    $path.AddBezier((New-Point 75 32), (New-Point 75 18), (New-Point 65 10), (New-Point 50 10))
    $path.CloseFigure()
    return $path
}

function New-RoundedSquarePath([double]$size, [double]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($radius -le 0) {
        $path.AddRectangle((New-Object System.Drawing.RectangleF(0, 0, [float]$size, [float]$size)))
        return $path
    }

    $diameter = $radius * 2
    $path.AddArc(0, 0, [float]$diameter, [float]$diameter, 180, 90)
    $path.AddArc([float]($size - $diameter), 0, [float]$diameter, [float]$diameter, 270, 90)
    $path.AddArc([float]($size - $diameter), [float]($size - $diameter), [float]$diameter, [float]$diameter, 0, 90)
    $path.AddArc(0, [float]($size - $diameter), [float]$diameter, [float]$diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-ClinicIcon {
    param(
        [Parameter(Mandatory = $true)][int]$Size,
        [Parameter(Mandatory = $true)][string]$FileName,
        # Porcentaje del lienzo que ocupa el diente
        [double]$ToothRatio = 0.62,
        # 0 = cuadrado completo (maskable / apple-touch-icon)
        [double]$CornerRatio = 0.22
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $bitmap.SetResolution(144, 144)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)

        $sizeF = [float]$Size
        $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.PointF(0, 0)),
            (New-Object System.Drawing.PointF($sizeF, $sizeF)),
            $gradientStart,
            $gradientEnd
        )

        try {
            if ($CornerRatio -gt 0) {
                $background = New-RoundedSquarePath $Size ($Size * $CornerRatio)
            }
            else {
                $background = New-RoundedSquarePath $Size 0
            }

            try {
                $graphics.FillPath($gradient, $background)
            }
            finally {
                $background.Dispose()
            }
        }
        finally {
            $gradient.Dispose()
        }

        $toothSize = $Size * $ToothRatio
        $script:span = $toothSize / 100
        $script:offsetX = ($Size - $toothSize) / 2
        $script:offsetY = ($Size - $toothSize) / 2

        $tooth = New-ToothPath
        try {
            $toothBrush = New-Object System.Drawing.SolidBrush($toothColor)
            try {
                $graphics.FillPath($toothBrush, $tooth)
            }
            finally {
                $toothBrush.Dispose()
            }
        }
        finally {
            $tooth.Dispose()
        }

        $target = Join-Path $iconsDir $FileName
        $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host "OK -> $target"
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

New-ClinicIcon -Size 192 -FileName 'icon-192.png'
New-ClinicIcon -Size 512 -FileName 'icon-512.png'
# Maskable: fondo a sangre y diente dentro de la zona segura (~80%)
New-ClinicIcon -Size 512 -FileName 'maskable-512.png' -ToothRatio 0.5 -CornerRatio 0
New-ClinicIcon -Size 192 -FileName 'maskable-192.png' -ToothRatio 0.5 -CornerRatio 0
New-ClinicIcon -Size 180 -FileName 'apple-touch-icon-180.png' -ToothRatio 0.6 -CornerRatio 0
New-ClinicIcon -Size 64 -FileName 'favicon-64.png' -ToothRatio 0.7 -CornerRatio 0.24

Write-Host 'Iconos generados en public/icons'
